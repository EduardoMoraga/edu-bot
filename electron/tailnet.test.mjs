import { describe, expect, it } from "vitest";

import { bareAddress, inTailscaleRange, isTailnetHost, isTailnetName, onTailnet, readTailnetPeers, readTailscaleStatusJson, tailnetHosts, tailnetInterfaceAddresses, tailnetOrigin } from "./tailnet.mjs";

/** The shape `tailscale status --json` prints (Tailscale 1.7x), trimmed to what is read. */
const status = (overrides = {}, self = {}) => JSON.stringify({
  BackendState: "Running",
  MagicDNSSuffix: "tail1234.ts.net",
  CertDomains: ["macmini.tail1234.ts.net"],
  Self: { DNSName: "macmini.tail1234.ts.net.", TailscaleIPs: ["fd7a:115c:a1e0::1234:abcd", "100.101.102.103"], ...self },
  ...overrides,
});

const v4 = (address) => ({ address, family: "IPv4", internal: false });
const v6 = (address) => ({ address, family: "IPv6", internal: false });

describe("reading tailscale status --json", () => {
  it("finds the MagicDNS name, the tailnet addresses (IPv4 first) and whether HTTPS certificates are on", () => {
    expect(readTailscaleStatusJson(status())).toEqual({
      state: "ready", name: "macmini.tail1234.ts.net", addresses: ["100.101.102.103", "fd7a:115c:a1e0::1234:abcd"], https: true,
    });
  });

  it("reads HTTPS from the https capability when CertDomains is absent, and off when neither says so", () => {
    expect(readTailscaleStatusJson(status({ CertDomains: null }, { CapMap: { https: null, "funnel": null } }))?.https).toBe(true);
    expect(readTailscaleStatusJson(status({ CertDomains: [] }))?.https).toBe(false);
  });

  it("names each state the row explains", () => {
    expect(readTailscaleStatusJson(status({ BackendState: "NeedsLogin" }))?.state).toBe("signed-out");
    expect(readTailscaleStatusJson(status({ BackendState: "Stopped" }))?.state).toBe("not-running");
    expect(readTailscaleStatusJson(status({ BackendState: "NeedsMachineAuth" }))?.state).toBe("needs-approval");
  });

  it("drops a name that is not a MagicDNS name and addresses outside Tailscale's ranges", () => {
    const read = readTailscaleStatusJson(status({}, { DNSName: "macmini.example.com.", TailscaleIPs: ["192.168.1.20", "100.64.0.7"] }));
    expect(read?.name).toBeNull();
    expect(read?.addresses).toEqual(["100.64.0.7"]);
  });

  it("is null for the GUI's startup text and for anything not an object", () => {
    for (const text of ["", "Tailscale started", "[]", "null", "{"]) expect(readTailscaleStatusJson(text)).toBeNull();
  });
});

describe("Tailscale's interface and ranges", () => {
  it("lists addresses only on Tailscale's own interface, never a bare 100.64/10 address on another one", () => {
    const interfaces = {
      en0: [v4("192.168.1.20")],
      utun4: [v4("100.101.102.103"), v6("fd7a:115c:a1e0::1234:abcd"), v6("fe80::1%utun4")],
      utun2: [v4("100.96.0.5")],
      tailscale0: [v4("100.70.0.9")],
    };
    expect(tailnetInterfaceAddresses(interfaces)).toEqual(["100.101.102.103", "100.70.0.9", "fd7a:115c:a1e0::1234:abcd"]);
    expect(onTailnet({ en0: [v4("192.168.1.20")], utun2: [v4("100.96.0.5")] })).toBe(false);
  });

  it("knows Tailscale's ranges and MagicDNS names", () => {
    expect(inTailscaleRange("100.64.0.1")).toBe(true);
    expect(inTailscaleRange("::ffff:100.127.255.254")).toBe(true);
    expect(inTailscaleRange("100.128.0.1")).toBe(false);
    expect(inTailscaleRange("[fd7a:115c:a1e0::1]")).toBe(true);
    expect(inTailscaleRange("fd00::1")).toBe(false);
    expect(isTailnetName("MacMini.tail1234.ts.net.")).toBe(true);
    for (const host of ["ts.net", "evil.ts.net.example.com", "a..ts.net", "-x.ts.net", "macmini.local"]) expect(isTailnetName(host)).toBe(false);
    expect(isTailnetHost("100.101.102.103")).toBe(true);
    expect(isTailnetHost("192.168.1.20")).toBe(false);
    expect(bareAddress("::ffff:100.101.102.103")).toBe("100.101.102.103");
  });
});

describe("what a share answers to", () => {
  it("builds the address another computer opens", () => {
    expect(tailnetOrigin("macmini.tail1234.ts.net", 8799)).toBe("http://macmini.tail1234.ts.net:8799");
    expect(tailnetOrigin("macmini.tail1234.ts.net", 443, true)).toBe("https://macmini.tail1234.ts.net");
    expect(tailnetOrigin("macmini.tail1234.ts.net", 8443, true)).toBe("https://macmini.tail1234.ts.net:8443");
  });

  it("accepts exactly the name and the bound addresses with their port", () => {
    const hosts = tailnetHosts({ name: "macmini.tail1234.ts.net", addresses: ["100.101.102.103", "fd7a:115c:a1e0::1"], port: 8799 });
    expect([...hosts].sort()).toEqual(["100.101.102.103:8799", "[fd7a:115c:a1e0::1]:8799", "macmini.tail1234.ts.net:8799"]);
    expect(tailnetHosts({ name: "evil.example.com", addresses: [], port: 8799 }).size).toBe(0);
  });
});

/** A tailnet like the owner's: this computer `omarchy` in tail9f9734, and one peer per case. IPs and ids are made up. */
const OWNER = 8000000000000001;
const peer = (name, over = {}) => ({ HostName: name, DNSName: `${name}.tail9f9734.ts.net.`, OS: "windows", UserID: OWNER, TailscaleIPs: ["100.80.0.1"], Online: true, ...over });
const tailnet = (peers, self = {}, top = {}) => JSON.stringify({
  BackendState: "Running",
  MagicDNSSuffix: "tail9f9734.ts.net",
  Self: { HostName: "omarchy", DNSName: "omarchy.tail9f9734.ts.net.", UserID: OWNER, TailscaleIPs: ["100.80.0.9"], ...self },
  Peer: Object.fromEntries(peers.map((p, index) => [`nodekey:${index}`, p])),
  ...top,
});
const kept = (text) => readTailnetPeers(text).peers.map((p) => p.hostName);

describe("reading the person's own computers from tailscale status --json", () => {
  const ffm = peer("ffm-eduardomoraga");
  const macMini = peer("mac-mini-de-eduardomoraga", { OS: "macOS", TailscaleIPs: ["100.80.0.2", "fd7a:115c:a1e0::2"] });
  const cheil = peer("cheil-sofland", { DNSName: "cheil-sofland.taile3dba8.ts.net.", UserID: 8000000000000777 });

  it("keeps own computers, online or off, with their name, system, state and addresses", () => {
    const read = readTailnetPeers(tailnet([ffm, macMini, peer("nucbox-m6", { Online: false })]));
    expect(read.ready).toBe(true);
    expect(read.peers).toEqual([
      { name: "ffm-eduardomoraga.tail9f9734.ts.net", hostName: "ffm-eduardomoraga", os: "windows", online: true, addresses: ["100.80.0.1"] },
      { name: "mac-mini-de-eduardomoraga.tail9f9734.ts.net", hostName: "mac-mini-de-eduardomoraga", os: "macOS", online: true, addresses: ["100.80.0.2", "fd7a:115c:a1e0::2"] },
      { name: "nucbox-m6.tail9f9734.ts.net", hostName: "nucbox-m6", os: "windows", online: false, addresses: ["100.80.0.1"] },
    ]);
  });

  it("never keeps another person's computer from another tailnet (cheil-sofland)", () => {
    expect(kept(tailnet([ffm, cheil, macMini]))).toEqual(["ffm-eduardomoraga", "mac-mini-de-eduardomoraga"]);
    expect(readTailnetPeers(tailnet([cheil])).dropped).toBe(1);
    expect(kept(tailnet([{ ...cheil, UserID: OWNER }]))).toEqual([]);
    expect(kept(tailnet([{ ...cheil, DNSName: "cheil-sofland.tail9f9734.ts.net." }]))).toEqual([]);
  });

  it("drops tagged nodes, shared nodes and anything unclear", () => {
    expect(kept(tailnet([
      peer("server", { Tags: ["tag:server"] }),
      peer("odd-tags", { Tags: "tag:server" }),
      peer("shared-in", { AltSharerUserID: 8000000000000555 }),
      peer("sharee", { ShareeNode: true }),
      peer("no-user", { UserID: undefined }),
      peer("zero-user", { UserID: 0 }),
      peer("text-user", { UserID: String(OWNER) }),
      peer("no-name", { DNSName: undefined }),
      peer("plain-name", { DNSName: "box.example.com." }),
      peer("deep", { DNSName: "a.deep.tail9f9734.ts.net." }),
      null,
      "nodekey",
      peer("ok", { Tags: [], AltSharerUserID: 0, ShareeNode: false }),
    ]))).toEqual(["ok"]);
  });

  it("keeps a phone like any other own device; whether it runs Edu Bot is the probe's to say", () => {
    expect(readTailnetPeers(tailnet([peer("s24-ultra-de-eduardo", { OS: "android", Online: false })])).peers[0]).toMatchObject({ os: "android", online: false });
  });

  it("compares owner ids exactly past 2^53, where two ids round to the same number", () => {
    const text = tailnet([peer("near", { UserID: 0 })], { UserID: 0 }).replace('"UserID":0', '"UserID":9007199254740993').replace('"UserID":0', '"UserID":9007199254740992');
    expect(kept(text)).toEqual([]);
    const same = tailnet([peer("same", { UserID: 0 })], { UserID: 0 }).replaceAll('"UserID":0', '"UserID":9007199254740993');
    expect(kept(same)).toEqual(["same"]);
  });

  it("lists nothing when Tailscale is not running, the JSON is bad, or this computer's owner or tailnet is unclear", () => {
    const none = { ready: false, peers: [], dropped: 0 };
    expect(readTailnetPeers(tailnet([ffm], {}, { BackendState: "Stopped" }))).toEqual(none);
    expect(readTailnetPeers("{not json")).toEqual(none);
    expect(readTailnetPeers("[]")).toEqual(none);
    expect(readTailnetPeers(null)).toEqual(none);
    expect(readTailnetPeers(tailnet([ffm], { UserID: undefined }))).toEqual(none);
    expect(readTailnetPeers(tailnet([ffm], { DNSName: undefined }))).toEqual(none);
    expect(readTailnetPeers(tailnet([ffm], {}, { MagicDNSSuffix: "taile3dba8.ts.net" }))).toEqual(none);
    expect(readTailnetPeers(tailnet([], {}, { Peer: null }))).toEqual({ ready: true, peers: [], dropped: 0 });
  });
});
