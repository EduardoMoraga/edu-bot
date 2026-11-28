import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FAKE_TAILSCALE = fileURLToPath(new URL("./fake-tailscale.mjs", import.meta.url));

export const OWNER = "eduardo@example.com";

/** `tailscale status --json` of this computer, shaped like Tailscale's, trimmed to what the trust rule reads. */
export function tailnetStatus({ login = OWNER, selfId = "nSELF1CNTRL", ips = ["100.100.1.1", "fd7a:115c:a1e0::1"] } = {}) {
  return {
    BackendState: "Running",
    Self: { ID: selfId, UserID: 4001, TailscaleIPs: ips, DNSName: "this-pc.tail1234.ts.net." },
    User: { "4001": { ID: 4001, LoginName: login, DisplayName: "Eduardo" }, "4002": { ID: 4002, LoginName: "someone@example.com" } },
  };
}

/** `tailscale whois --json <address>` of another node, shaped like Tailscale's. */
export function tailnetWhois({ address = "100.100.2.2", login = OWNER, stableId = "nLAPTOP2CNTRL", tags, sharer }: { address?: string; login?: string; stableId?: string; tags?: string[]; sharer?: number } = {}) {
  return {
    Node: { ID: 77, StableID: stableId, Name: "laptop.tail1234.ts.net.", ComputedName: "laptop", User: 4001, Addresses: [`${address}/32`, "fd7a:115c:a1e0::2/128"], ...(tags ? { Tags: tags } : {}), ...(sharer ? { Sharer: sharer } : {}) },
    UserProfile: { ID: 4001, LoginName: login, DisplayName: "Eduardo" },
    CapMap: {},
  };
}

/** A copy of the fake `tailscale` in a folder of its own (`dir`, for the test to remove). */
export function fakeTailscale({ under = tmpdir() } = {}) {
  const dir = mkdtempSync(join(under, "omb-fake-tailscale-"));
  const cli = join(dir, "tailscale.mjs");
  copyFileSync(FAKE_TAILSCALE, cli);
  chmodSync(cli, 0o755);
  const fake = {
    dir,
    cli,
    status: (value: unknown) => writeFileSync(join(dir, "status.json"), typeof value === "string" ? value : JSON.stringify(value)),
    whois: (answers: Record<string, unknown>) => writeFileSync(join(dir, "whois.json"), JSON.stringify(answers)),
    calls: () => (existsSync(join(dir, "calls.ndjson")) ? readFileSync(join(dir, "calls.ndjson"), "utf8").trim().split("\n").map((line) => JSON.parse(line) as string[]) : []),
  };
  return fake;
}
