import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

import { bareAddress, inTailscaleRange } from "../electron/tailnet.mjs";
import { runTailscaleStatus, runTailscaleWhois, tailscaleStatusCandidates, type TailscaleRun } from "../electron/tailscale-check.mjs";
import type { TailnetSignInErrorCode } from "../shared/wire.ts";
import { networkPeer, PROXY_HEADERS, requestSource } from "./request-auth.ts";
import { SCOPES, type PublicSession, type SessionRegistry } from "./sessions.ts";

export type TailnetTrust = { ok: true; node: { stableId: string; name: string } } | { ok: false; reason: string };

type Json = Record<string, unknown>;

const object = (value: unknown): Json | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null);
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function parse(stdout: string | null): Json | null {
  try {
    return object(JSON.parse(String(stdout ?? "")));
  } catch {
    return null;
  }
}

const addressesOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).map((entry) => bareAddress(text(entry).replace(/\/\d+$/, ""))).filter(Boolean);

const refuse = (reason: string): TailnetTrust => ({ ok: false, reason });

/**
 * Security: the caller at `remoteIp` is trusted only when this computer's own Tailscale (`statusJson`, from
 * `tailscale status --json`) and its answer for that address (`whoisJson`, from `tailscale whois --json`) agree that the
 * caller is another node, untagged and not shared in, owned by the very login that owns this computer. Anything missing or
 * malformed is a refusal.
 */
export function tailnetCallerTrusted(statusJson: string | null, whoisJson: string | null, remoteIp: string): TailnetTrust {
  const status = parse(statusJson);
  const self = object(status?.Self);
  if (!status || !self) return refuse("this computer's Tailscale did not answer");
  const ownerId = self.UserID;
  const ownerLogin = (typeof ownerId === "number" || typeof ownerId === "string") ? text(object(object(status.User)?.[String(ownerId)])?.LoginName).toLowerCase() : "";
  if (!ownerLogin) return refuse("this computer's Tailscale owner is unknown");

  const whois = parse(whoisJson);
  const node = object(whois?.Node);
  const profile = object(whois?.UserProfile);
  if (!node || !profile) return refuse("Tailscale does not know the caller");
  const stableId = text(node.StableID);
  if (!stableId) return refuse("Tailscale does not know the caller");
  const remote = bareAddress(remoteIp);
  const callerAddresses = addressesOf(node.Addresses);
  if (!remote || !callerAddresses.includes(remote)) return refuse("Tailscale names another address for the caller");
  if (Array.isArray(node.Tags) ? node.Tags.length > 0 : node.Tags !== undefined && node.Tags !== null) return refuse("the caller is a tagged node");
  if (node.Sharer !== undefined && node.Sharer !== null && node.Sharer !== 0) return refuse("the caller is shared from another tailnet");
  const ownAddresses = addressesOf(self.TailscaleIPs);
  if (text(self.ID) === stableId || callerAddresses.some((address) => ownAddresses.includes(address))) return refuse("the caller is this computer");
  const callerLogin = text(profile.LoginName).toLowerCase();
  if (!callerLogin || callerLogin !== ownerLogin) return refuse("the caller belongs to another Tailscale account");

  const name = (text(node.ComputedName) || text(node.Name).split(".")[0] || stableId).slice(0, 63);
  return { ok: true, node: { stableId, name } };
}

export interface TailscaleReader {
  status(): Promise<string | null>;
  whois(address: string): Promise<string | null>;
}

/** Each answer comes from the first of `candidates` that is installed; null when none is. */
export function tailscaleReader(candidates: readonly string[] = tailscaleStatusCandidates()): TailscaleReader {
  const first = async (run: (cli: string) => Promise<TailscaleRun>) => {
    for (const cli of candidates) {
      const result = await run(cli);
      if (!result.missing) return result.stdout;
    }
    return null;
  };
  return {
    status: () => first(runTailscaleStatus),
    whois: (address) => first((cli) => runTailscaleWhois(cli, address)),
  };
}

const LABEL_MAX = 60;
const PLATFORMS = new Set(["darwin", "win32", "linux"]);

/** The body of POST /api/auth/tailnet, or null when it is not one. */
export function readTailnetSignIn(body: unknown): { label: string; cookie: boolean } | null {
  const raw = object(body);
  if (!raw) return null;
  if (raw.platform !== undefined && !PLATFORMS.has(raw.platform as string)) return null;
  if (raw.cookie !== undefined && typeof raw.cookie !== "boolean") return null;
  const label = typeof raw.label === "string" ? raw.label.replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim().slice(0, LABEL_MAX).trim() : "";
  return label ? { label, cookie: raw.cookie === true } : null;
}

type TailnetRefusal = { ok: false; status: number; code: TailnetSignInErrorCode; error: string; retryAfterMs?: number };
export type TailnetSignIn = { ok: true; token: string; session: PublicSession } | TailnetRefusal;

export interface TailnetSignInOptions {
  sessions: Pick<SessionRegistry, "attemptAllowed" | "noteFailure" | "issue" | "revoke">;
  tailscale: TailscaleReader;
  /** True only for a request the tailnet listener itself accepted (`TailnetShare.arrivedHere`). */
  arrivedOnTailnet: (req: IncomingMessage) => boolean;
  /** Why this server never takes it (a Cloud, a hosted workspace), else null. */
  unavailable: string | null;
  /** A test rig's own address playing a tailnet one (`OMB_TEST_TAILNET_STAND_IN`). */
  standIn?: string;
  log?: (line: string) => void;
}

/** A direct peer on the tailnet listener: a Tailscale address, not this machine's loopback, no proxy in between. */
function directTailnetPeer(req: IncomingMessage, standIn: string | undefined): string | null {
  if (!networkPeer(req) || PROXY_HEADERS.some((name) => req.headers[name] !== undefined)) return null;
  const remote = bareAddress(req.socket.remoteAddress);
  if (isIP(remote) === 0) return null;
  return inTailscaleRange(remote) || (Boolean(standIn) && remote === standIn) ? remote : null;
}

export function createTailnetSignIn(options: TailnetSignInOptions) {
  const log = options.log ?? (() => {});
  const byNode = new Map<string, string>();
  const refused = (req: IncomingMessage, status: number, code: TailnetSignInErrorCode, error: string, reason = error): TailnetRefusal => {
    log(`tailnet sign-in refused from ${requestSource(req)}: ${reason}`);
    return { ok: false, status, code, error };
  };

  return async function signIn(req: IncomingMessage, label: string): Promise<TailnetSignIn> {
    if (options.unavailable) return refused(req, 403, "tailnet_unavailable", options.unavailable);
    const remote = options.arrivedOnTailnet(req) ? directTailnetPeer(req, options.standIn) : null;
    if (!remote) return refused(req, 403, "tailnet_not_direct", "only another computer on this computer's tailnet, connecting directly, may sign in this way");
    const source = requestSource(req);
    const allowed = options.sessions.attemptAllowed(source);
    if (!allowed.ok) return { ...refused(req, 429, "tailnet_too_many", "too many refused attempts; try again later"), retryAfterMs: allowed.retryAfterMs };
    const [status, whois] = await Promise.all([options.tailscale.status(), options.tailscale.whois(remote)]);
    const trust = tailnetCallerTrusted(status, whois, remote);
    if (!trust.ok) {
      options.sessions.noteFailure(source);
      return refused(req, 403, "tailnet_not_trusted", "this computer trusts only its owner's own untagged computers on Tailscale", trust.reason);
    }
    const issued = options.sessions.issue({ label: `${label} (Tailscale)`, scopes: [...SCOPES] });
    const previous = byNode.get(trust.node.stableId);
    byNode.set(trust.node.stableId, issued.session.id);
    if (previous && previous !== issued.session.id) options.sessions.revoke(previous);
    return { ok: true, token: issued.token, session: issued.session };
  };
}
