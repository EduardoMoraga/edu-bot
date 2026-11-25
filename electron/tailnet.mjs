// What Tailscale says about this computer, and the exact names and addresses a share on the tailnet answers to. Runs
// nothing and imports nothing, so the window's bundle can read it too.

const TAILSCALE_V6 = /^fd7a:115c:a1e0:/i;
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const TAILNET_NAME = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})*\\.ts\\.net$`);

/** An address as a socket reports it, without the IPv4-mapped prefix, zone or brackets. */
export const bareAddress = (address) => String(address ?? "").trim().replace(/^\[|\]$/g, "").replace(/^::ffff:(?=\d)/i, "").replace(/%.*$/, "").toLowerCase();

function ipv4(address) {
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!parts) return null;
  const octets = parts.slice(1).map(Number);
  return octets.some((octet) => octet > 255) ? null : octets;
}

/** Tailscale's own ranges: 100.64.0.0/10 and fd7a:115c:a1e0::/48. 100.64/10 is RFC 6598 shared space that carrier NAT
 * and other VPNs use too, so on its own it never proves a tailnet. */
export function inTailscaleRange(address) {
  const value = bareAddress(address);
  const v4 = ipv4(value);
  if (v4) return v4[0] === 100 && v4[1] >= 64 && v4[1] <= 127;
  return TAILSCALE_V6.test(value);
}

/** A MagicDNS name, like `macmini.tail1234.ts.net`; a trailing dot is allowed. */
export function isTailnetName(host) {
  return TAILNET_NAME.test(String(host ?? "").trim().toLowerCase().replace(/\.$/, ""));
}

/** A host only a tailnet reaches: a MagicDNS name or an address in Tailscale's ranges. */
export const isTailnetHost = (host) => isTailnetName(host) || inTailscaleRange(host);

/** Addresses on Tailscale's own interface: `tailscale0` on Linux, "Tailscale" on Windows, and on macOS the utun that
 * carries a fd7a:115c:a1e0::/48 address. IPv4 first. */
export function tailnetInterfaceAddresses(interfaces) {
  const found = [];
  for (const [name, entries = []] of Object.entries(interfaces ?? {})) {
    const list = entries ?? [];
    if (!/^tailscale/i.test(name) && !list.some((entry) => TAILSCALE_V6.test(entry?.address ?? ""))) continue;
    for (const entry of list) {
      const address = bareAddress(entry?.address);
      if (inTailscaleRange(address) && !found.includes(address)) found.push(address);
    }
  }
  return found.sort((a, b) => Number(a.includes(":")) - Number(b.includes(":")));
}

export const onTailnet = (interfaces) => tailnetInterfaceAddresses(interfaces).length > 0;

/**
 * One `tailscale status --json`, read: `state` is "ready" (signed in and connected), "signed-out", "not-running" or
 * "needs-approval"; `name` this computer's MagicDNS name; `addresses` its tailnet addresses; `https` whether the tailnet
 * hands out certificates (`CertDomains`, or the `https` capability in `Self.CapMap`), without which `tailscale serve`
 * waits on an enablement link. Null when the text is not that JSON.
 */
export function readTailscaleStatusJson(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(String(stdout ?? ""));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const self = parsed.Self && typeof parsed.Self === "object" ? parsed.Self : {};
  const dns = typeof self.DNSName === "string" ? self.DNSName.trim().toLowerCase().replace(/\.$/, "") : "";
  const backend = typeof parsed.BackendState === "string" ? parsed.BackendState : "";
  const state = backend === "Running" ? "ready" : backend === "NeedsMachineAuth" ? "needs-approval" : backend === "Stopped" || backend === "Starting" || backend === "NoState" ? "not-running" : "signed-out";
  const addresses = (Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs : []).map(bareAddress).filter(inTailscaleRange);
  const certDomains = Array.isArray(parsed.CertDomains) && parsed.CertDomains.some((domain) => typeof domain === "string" && domain);
  const capability = self.CapMap && typeof self.CapMap === "object" && Object.hasOwn(self.CapMap, "https");
  return { state, name: isTailnetName(dns) ? dns : null, addresses: addresses.sort((a, b) => Number(a.includes(":")) - Number(b.includes(":"))), https: Boolean(certDomains || capability) };
}

const authority = (host, port) => (host.includes(":") ? `[${host}]` : host) + (port ? `:${port}` : "");

/** The address another computer opens: `https://<name>` when `tailscale serve` fronts this one with HTTPS, else
 * `http://<name>:<port>` (inside WireGuard, so encrypted despite the http). */
export function tailnetOrigin(name, port, https = false) {
  if (https) return port && port !== 443 ? `https://${name}:${port}` : `https://${name}`;
  return `http://${authority(name, port)}`;
}

/**
 * Security: the only Host headers a listener on the tailnet answers, exactly: its MagicDNS name and the addresses it is
 * bound to, each with its port. A page that rebinds its own name to a tailnet address sends that name, so it is refused.
 */
export function tailnetHosts({ name, addresses = [], port }) {
  const hosts = new Set();
  if (isTailnetName(name)) {
    const bare = name.toLowerCase().replace(/\.$/, "");
    hosts.add(authority(bare, port));
  }
  for (const address of addresses) {
    const value = bareAddress(address);
    if (value) hosts.add(authority(value, port));
  }
  return hosts;
}

/** Keeps a `UserID` exactly as written: Tailscale's ids are int64 and pass 2^53, where two can round to the same number. */
function exactUserIds(key, value, context) {
  if (key !== "UserID" && key !== "AltSharerUserID") return value;
  if (typeof context?.source === "string" && /^\d+$/.test(context.source)) return context.source;
  return typeof value === "number" && Number.isSafeInteger(value) ? String(value) : null;
}

const ownerId = (value) => (typeof value === "string" && /^[1-9]\d*$/.test(value) ? value : null);
const magicDns = (value) => (typeof value === "string" ? value.trim().toLowerCase().replace(/\.$/, "") : "");
const suffixOf = (name) => name.slice(name.indexOf(".") + 1);

/**
 * Security: a peer counts as the person's own computer only when Tailscale says so on every count: the same `UserID` as
 * this computer, no `Tags`, a MagicDNS name directly in this computer's tailnet, and not a node shared with this tailnet
 * from another one. Tailscale 1.104 (checked 2026-11-25) lists a shared-in node under the sharing tailnet's own MagicDNS
 * suffix, and marks shared nodes with `AltSharerUserID` and `ShareeNode` (`ipn/ipnstate` PeerStatus). Anything missing
 * or unreadable drops the peer.
 */
function ownPeer(peer, self) {
  if (!peer || typeof peer !== "object" || Array.isArray(peer)) return false;
  const name = magicDns(peer.DNSName);
  if (!isTailnetName(name) || suffixOf(name) !== self.suffix || name.split(".").length !== self.suffix.split(".").length + 1) return false;
  if (ownerId(peer.UserID) !== self.userId) return false;
  if (peer.Tags !== undefined && peer.Tags !== null && !(Array.isArray(peer.Tags) && peer.Tags.length === 0)) return false;
  if (peer.ShareeNode !== undefined && peer.ShareeNode !== false) return false;
  return peer.AltSharerUserID === undefined || peer.AltSharerUserID === null || peer.AltSharerUserID === "0";
}

/**
 * The person's own other computers in one `tailscale status --json`: `{ ready, peers, dropped }`. `ready` needs Tailscale
 * running and signed in, with this computer's owner and tailnet readable; without it `peers` is empty. Each peer has
 * `name` (its MagicDNS name), `hostName`, `os`, `online` and `addresses`; `dropped` counts the others.
 */
export function readTailnetPeers(stdout) {
  const none = { ready: false, peers: [], dropped: 0 };
  let parsed;
  try {
    parsed = JSON.parse(String(stdout ?? ""), exactUserIds);
  } catch {
    return none;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.BackendState !== "Running") return none;
  const selfNode = parsed.Self && typeof parsed.Self === "object" ? parsed.Self : {};
  const selfName = magicDns(selfNode.DNSName);
  const userId = ownerId(selfNode.UserID);
  if (!userId || !isTailnetName(selfName)) return none;
  const self = { userId, suffix: suffixOf(selfName) };
  if (typeof parsed.MagicDNSSuffix === "string" && magicDns(parsed.MagicDNSSuffix) !== self.suffix) return none;
  const all = parsed.Peer && typeof parsed.Peer === "object" && !Array.isArray(parsed.Peer) ? Object.values(parsed.Peer) : [];
  const peers = all.filter((peer) => ownPeer(peer, self)).map((peer) => ({
    name: magicDns(peer.DNSName),
    hostName: typeof peer.HostName === "string" ? peer.HostName : "",
    os: typeof peer.OS === "string" ? peer.OS : "",
    online: peer.Online === true,
    addresses: (Array.isArray(peer.TailscaleIPs) ? peer.TailscaleIPs : []).map(bareAddress).filter(inTailscaleRange),
  }));
  return { ready: true, peers: peers.sort((a, b) => a.name.localeCompare(b.name)), dropped: all.length - peers.length };
}
