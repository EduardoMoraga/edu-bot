// My computers: the person's own other computers on Tailscale, and which of them run Edu Bot. Only looks: it pairs nothing,
// trusts nothing and changes nothing on either side. Runs only while the list is open in the desktop window.
import os from "node:os";

import { DESKTOP_PORTS } from "./desktop-ports.mjs";
import { readTailnetPeers } from "./tailnet.mjs";
import { runTailscaleStatus, TAILSCALE_CLI_PATHS } from "./tailscale-check.mjs";

const DESCRIPTOR = "/.well-known/openmausbot/environment";
const BODY_MAX_BYTES = 8_192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAME_MAX = 60;

/** Security: text another computer chose, made safe to show: no control, format (bidi, zero-width) or line-break
 * characters, spaces collapsed, at most `max` characters. */
export function plainText(value, max = NAME_MAX) {
  if (typeof value !== "string") return "";
  const clean = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
  return Array.from(clean).slice(0, max).join("").trim();
}

/** Tailscale's own words for a system (`macOS`, `windows`, `linux`, `android`, `iOS`), else none. */
const tailscaleOs = (os) => (typeof os === "string" && /^[A-Za-z0-9]{1,16}$/.test(os) ? os : null);

/**
 * An Edu Bot's public description, read strictly: `environmentId` a UUID, `label`, `platform` and `version` strings and a
 * `capabilities` object, else null. Only the label, platform and version come out, each cleaned and capped.
 */
export function readDescriptor(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const { environmentId, label, platform, version, capabilities } = body;
  if (typeof environmentId !== "string" || !UUID.test(environmentId)) return null;
  if (typeof label !== "string" || typeof platform !== "string" || typeof version !== "string") return null;
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) return null;
  return {
    label: plainText(label),
    platform: /^[a-z0-9]{1,16}$/.test(platform) ? platform : null,
    version: /^[0-9A-Za-z.+-]{1,32}$/.test(version) ? version : null,
  };
}

/** Where an Edu Bot on that computer answers: behind `tailscale serve`, else on the tailnet on one of the desktop's ports. */
export const computerOrigins = (name) => [`https://${name}`, ...DESKTOP_PORTS.map((port) => `http://${name}:${port}`)];

/** The body as JSON, or null past BODY_MAX_BYTES whatever Content-Length said. */
async function smallJson(response) {
  if (Number(response.headers?.get?.("content-length")) > BODY_MAX_BYTES) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > BODY_MAX_BYTES) {
      void reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

/** One origin, asked who it is: no cookies, no credentials, and no redirect followed anywhere. */
async function describe(origin, fetchImpl, timeoutMs) {
  try {
    const response = await fetchImpl(`${origin}${DESCRIPTOR}`, { redirect: "error", cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok || response.redirected || new URL(response.url || origin).origin !== origin) {
      void response.body?.cancel().catch(() => {});
      return null;
    }
    return readDescriptor(await smallJson(response));
  } catch {
    return null;
  }
}

/** The first of `origins`, in order, that answers as an Edu Bot: `{ ...descriptor, address }`, else null. All are asked
 * at once, so a computer takes at most `timeoutMs`. */
export async function probeComputer(origins, { fetch: fetchImpl, timeoutMs = 3_000 }) {
  const answers = await Promise.all(origins.map((origin) => describe(origin, fetchImpl, timeoutMs)));
  const index = answers.findIndex(Boolean);
  return index === -1 ? null : { ...answers[index], address: origins[index] };
}

/** Standalone `tailscale` first, then the CLI inside the macOS app (App Store and the standalone .app both
 * ship it at Contents/MacOS/Tailscale; `runTailscaleStatus` sets TAILSCALE_BE_CLI so the app does not open).
 * https://tailscale.com/docs/reference/tailscale-cli?tab=macos */
export function tailscaleStatusCandidates(home = os.homedir()) {
  return [
    ...TAILSCALE_CLI_PATHS,
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    `${home}/Applications/Tailscale.app/Contents/MacOS/Tailscale`,
  ];
}

/** `tailscale status --json` through the first command-line tool that is there, including the macOS app's; null without one. */
export async function readStatusJson({ run = runTailscaleStatus, candidates = tailscaleStatusCandidates() } = {}) {
  for (const cli of candidates) {
    const result = await run(cli);
    if (!result.missing) return result.stdout;
  }
  return null;
}

/** What the list shows for one computer: its Edu Bot's name when one answers, else Tailscale's name for it. */
function entry(peer, found) {
  const hostName = plainText(peer.hostName);
  const name = found?.label || (hostName && hostName.toLowerCase() !== "localhost" ? hostName : peer.name.split(".")[0]);
  const base = { id: peer.name, name, os: tailscaleOs(peer.os) };
  if (!peer.online) return { ...base, status: "offline" };
  if (!found) return { ...base, status: "noEduBot" };
  return { ...base, status: "eduBot", version: found.version, platform: found.platform, address: found.address };
}

async function eachLimited(items, limit, work) {
  const results = Array.from({ length: items.length });
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

/**
 * `list()` resolves `{ tailscale: "ready" | "off", computers }`, Edu Bots first. One round runs at a time: a call while one
 * runs gets that round, and a call within `minGapMs` of the last gets its answer. `status()` is `tailscale status --json`.
 */
export function createTailnetComputers({ status = () => readStatusJson(), fetch: fetchImpl, origins = computerOrigins, timeoutMs = 3_000, concurrency = 4, minGapMs = 5_000, now = Date.now }) {
  let round = null;
  let last = null;
  let lastAt = 0;

  async function run() {
    const read = readTailnetPeers(await status().catch(() => null));
    if (!read.ready) return { tailscale: "off", computers: [] };
    const computers = await eachLimited(read.peers, concurrency, async (peer) =>
      entry(peer, peer.online ? await probeComputer(origins(peer.name), { fetch: fetchImpl, timeoutMs }) : null));
    const rank = { eduBot: 0, noEduBot: 1, offline: 2 };
    return { tailscale: "ready", computers: computers.sort((a, b) => rank[a.status] - rank[b.status] || a.name.localeCompare(b.name)) };
  }

  const api = {
    list() {
      if (round) return round;
      if (last && now() - lastAt < minGapMs) return Promise.resolve(last);
      round = run().then((answer) => {
        last = answer;
        lastAt = now();
        return answer;
      }).finally(() => {
        round = null;
      });
      return round;
    },
    /** Only the desktop window's own page asks (`localOnly`). */
    install(ipcMain, localOnly) {
      ipcMain.handle("companion:tailnet-computers", localOnly("companion:tailnet-computers", () => api.list()));
    },
  };
  return api;
}
