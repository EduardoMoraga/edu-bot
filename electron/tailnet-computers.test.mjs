import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { tailscaleInstall } from "./tailscale-check.mjs";
import { computerOrigins, createTailnetComputers, plainText, probeComputer, readDescriptor, readStatusJson, tailscaleStatusCandidates } from "./tailnet-computers.mjs";

const ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const descriptor = (over = {}) => ({ environmentId: ID, label: "Mac mini", platform: "darwin", version: "0.1.140", capabilities: { remoteSessions: true }, ...over });

const servers = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => { server.closeAllConnections(); server.close(done); })));
});

/** A fake computer on 127.0.0.1; `seen` keeps each request's headers. */
async function fake(answer) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    answer(req, res);
  });
  servers.push(server);
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { origin: `http://127.0.0.1:${server.address().port}`, seen };
}

const json = (body, status = 200) => (_req, res) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

describe("reading an Edu Bot's public description", () => {
  it("takes the name, system and version of a well-formed one", () => {
    expect(readDescriptor(descriptor())).toEqual({ label: "Mac mini", platform: "darwin", version: "0.1.140" });
  });

  it("refuses anything not shaped exactly like one", () => {
    for (const body of [null, [], "x", descriptor({ environmentId: "not-a-uuid" }), descriptor({ environmentId: undefined }), descriptor({ label: 7 }),
      descriptor({ platform: undefined }), descriptor({ version: null }), descriptor({ capabilities: undefined }), descriptor({ capabilities: [] })]) {
      expect(readDescriptor(body)).toBeNull();
    }
  });

  it("cleans and caps what another computer chose to say", () => {
    const odd = readDescriptor(descriptor({ label: `  Evil\u202Eexe\u0000\n\u200Bname ${"x".repeat(200)}`, platform: "darwin<script>", version: "1.0.0; rm -rf" }));
    expect(odd?.label).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    expect(odd?.label.startsWith("Evil exe name x")).toBe(true);
    expect(Array.from(odd?.label ?? "")).toHaveLength(60);
    expect(odd?.platform).toBeNull();
    expect(odd?.version).toBeNull();
    expect(plainText("😀".repeat(80))).toBe("😀".repeat(60));
    expect(plainText(undefined)).toBe("");
  });
});

describe("asking a computer whether it runs Edu Bot", () => {
  it("finds an Edu Bot, says which address answered, and sends no cookie or credential", async () => {
    const good = await fake(json(descriptor()));
    expect(await probeComputer([good.origin], { fetch })).toEqual({ label: "Mac mini", platform: "darwin", version: "0.1.140", address: good.origin });
    expect(good.seen[0].url).toBe("/.well-known/openmausbot/environment");
    expect(good.seen[0].headers.cookie).toBeUndefined();
    expect(good.seen[0].headers.authorization).toBeUndefined();
  });

  it("prefers the first address in order that answers as Edu Bot", async () => {
    const other = await fake(json({ hello: "world" }));
    const good = await fake(json(descriptor()));
    expect((await probeComputer([other.origin, good.origin], { fetch }))?.address).toBe(good.origin);
  });

  it("is not an Edu Bot on bad JSON, an error status, or a body too large", async () => {
    const bad = await fake(json("{nope"));
    const refused = await fake(json(descriptor(), 401));
    const huge = await fake(json({ ...descriptor(), padding: "x".repeat(20_000) }));
    const chunked = await fake((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.write(`{"environmentId":"${ID}","label":"`);
      res.end(`${"y".repeat(20_000)}","platform":"linux","version":"1","capabilities":{}}`);
    });
    for (const server of [bad, refused, huge, chunked]) expect(await probeComputer([server.origin], { fetch })).toBeNull();
  });

  it("gives up on a slow answer after the timeout", async () => {
    const slow = await fake((_req, res) => setTimeout(() => json(descriptor())(_req, res), 2_000));
    const started = Date.now();
    expect(await probeComputer([slow.origin], { fetch, timeoutMs: 200 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  it("follows no redirect, least of all to another host", async () => {
    const elsewhere = await fake(json(descriptor()));
    const moved = await fake((_req, res) => { res.writeHead(302, { location: `${elsewhere.origin.replace("127.0.0.1", "localhost")}/.well-known/openmausbot/environment` }); res.end(); });
    expect(await probeComputer([moved.origin], { fetch })).toBeNull();
    expect(elsewhere.seen).toHaveLength(0);
  });

  it("tries https first, then the desktop's ports on the tailnet", () => {
    expect(computerOrigins("ffm.tail9f9734.ts.net")).toEqual(["https://ffm.tail9f9734.ts.net", "http://ffm.tail9f9734.ts.net:8799", "http://ffm.tail9f9734.ts.net:18799", "http://ffm.tail9f9734.ts.net:28799"]);
  });
});

const OWNER = 8000000000000001;
const status = (peers) => JSON.stringify({
  BackendState: "Running",
  Self: { DNSName: "omarchy.tail9f9734.ts.net.", UserID: OWNER },
  Peer: Object.fromEntries(peers.map(([name, over], index) => [`k${index}`, { HostName: name, DNSName: `${name}.tail9f9734.ts.net.`, OS: "windows", UserID: OWNER, Online: true, ...over }])),
});

describe("the My computers list", () => {
  it("probes only own online computers, Edu Bots first, and never another person's", async () => {
    const good = await fake(json(descriptor({ label: "FFM" })));
    const asked = [];
    const list = createTailnetComputers({
      status: async () => status([["s24-ultra", { OS: "android" }], ["ffm-eduardomoraga", {}], ["nucbox-m6", { Online: false }], ["localhost", { DNSName: "ipad153.tail9f9734.ts.net.", OS: "iOS", Online: false }],
        ["cheil-sofland", { DNSName: "cheil-sofland.taile3dba8.ts.net.", UserID: 8000000000000777 }]]),
      origins: (name) => { asked.push(name); return name.startsWith("ffm-") ? [good.origin] : []; },
      fetch,
    });
    expect(await list.list()).toEqual({ tailscale: "ready", computers: [
      { id: "ffm-eduardomoraga.tail9f9734.ts.net", name: "FFM", os: "windows", status: "eduBot", version: "0.1.140", platform: "darwin", address: good.origin },
      { id: "s24-ultra.tail9f9734.ts.net", name: "s24-ultra", os: "android", status: "noEduBot" },
      { id: "ipad153.tail9f9734.ts.net", name: "ipad153", os: "iOS", status: "offline" },
      { id: "nucbox-m6.tail9f9734.ts.net", name: "nucbox-m6", os: "windows", status: "offline" },
    ] });
    expect(asked.sort()).toEqual(["ffm-eduardomoraga.tail9f9734.ts.net", "s24-ultra.tail9f9734.ts.net"]);
  });

  it("is off, and asks no computer, when Tailscale is not ready or not there", async () => {
    let probed = 0;
    const origins = () => { probed++; return []; };
    const interfaces = () => ({ lo: [{ address: "127.0.0.1" }] });
    expect(await createTailnetComputers({ status: async () => '{"BackendState":"Stopped"}', interfaces, origins, fetch }).list()).toEqual({ tailscale: "off", computers: [] });
    expect(await createTailnetComputers({ status: async () => null, interfaces, origins, fetch }).list()).toEqual({ tailscale: "off", computers: [] });
    expect(await createTailnetComputers({ status: async () => { throw new Error("gone"); }, interfaces, origins, fetch }).list()).toEqual({ tailscale: "off", computers: [] });
    expect(probed).toBe(0);
  });

  it("says it could not read the list, not that Tailscale is off, when this computer is on the tailnet", async () => {
    let probed = 0;
    const origins = () => { probed++; return []; };
    const onMac = () => ({ utun4: [{ address: "100.90.146.38" }, { address: "fd7a:115c:a1e0::1a01:9226" }] });
    for (const read of [async () => null, async () => "", async () => { throw new Error("gone"); }]) {
      expect(await createTailnetComputers({ status: read, interfaces: onMac, origins, fetch }).list()).toEqual({ tailscale: "unreadable", computers: [] });
    }
    expect(probed).toBe(0);
  });

  it("runs one round at a time and answers a quick second ask from the last round", async () => {
    let reads = 0;
    let clock = 0;
    const list = createTailnetComputers({ status: async () => { reads++; return status([]); }, fetch, now: () => clock, minGapMs: 5_000 });
    const [a, b] = [list.list(), list.list()];
    expect(a).toBe(b);
    await a;
    clock = 4_000;
    await list.list();
    expect(reads).toBe(1);
    clock = 9_001;
    await list.list();
    expect(reads).toBe(2);
  });

  it("probes at most `concurrency` computers at once", async () => {
    let open = 0;
    let most = 0;
    const slowFetch = async () => { open++; most = Math.max(most, open); await new Promise((done) => setTimeout(done, 20)); open--; throw new Error("refused"); };
    const peers = Array.from({ length: 9 }, (_, index) => [`pc${index}`, {}]);
    await createTailnetComputers({ status: async () => status(peers), origins: (name) => [`http://${name}:8799`], fetch: slowFetch, concurrency: 3 }).list();
    expect(most).toBe(3);
  });

  it("reads status --json from the first Tailscale command-line tool that is there", async () => {
    const ran = [];
    const run = async (cli) => { ran.push(cli); return cli === "b" ? { missing: false, stdout: "{}" } : { missing: true, stdout: "" }; };
    expect(await readStatusJson({ run, candidates: ["a", "b", "c"] })).toBe("{}");
    expect(ran).toEqual(["a", "b"]);
    expect(await readStatusJson({ run: async () => ({ missing: true }), candidates: ["a"] })).toBeNull();
  });
});

const APP_CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const READY = JSON.stringify({
  BackendState: "Running",
  Self: { DNSName: "mac.tail9f9734.ts.net.", UserID: OWNER },
  Peer: {},
});

describe("finding Tailscale for My computers", () => {
  const homes = [];
  afterEach(() => {
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  });

  it("reads status from a standalone CLI and does not open the macOS app", async () => {
    const ran = [];
    const run = async (cli) => {
      ran.push(cli);
      return cli === "/usr/bin/tailscale" ? { missing: false, stdout: READY } : { missing: true, stdout: "" };
    };
    expect(await readStatusJson({ run })).toBe(READY);
    expect(ran).toContain("/usr/bin/tailscale");
    expect(ran.some((cli) => cli.includes("Tailscale.app"))).toBe(false);
  });

  it("reads status from the macOS app when that is the only install", async () => {
    const home = mkdtempSync(join(tmpdir(), "omb-tailscale-app-"));
    homes.push(home);
    const bundle = join(home, "Applications", "Tailscale.app");
    mkdirSync(bundle, { recursive: true });
    expect(tailscaleInstall({ exists: (file) => file === bundle, env: { PATH: "" }, home, platform: "darwin" })).toBe("app-only");
    const ran = [];
    const run = async (cli) => {
      ran.push(cli);
      return cli === APP_CLI ? { missing: false, stdout: READY } : { missing: true, stdout: "" };
    };
    expect(await readStatusJson({ run })).toBe(READY);
    expect(ran).toContain(APP_CLI);
    expect(tailscaleStatusCandidates(home)).toContain(`${home}/Applications/Tailscale.app/Contents/MacOS/Tailscale`);
    const list = createTailnetComputers({ status: async () => readStatusJson({ run }), origins: () => [], fetch });
    expect(await list.list()).toEqual({ tailscale: "ready", computers: [] });
  });

  it("is off when neither a CLI nor the macOS app is installed", async () => {
    const home = mkdtempSync(join(tmpdir(), "omb-tailscale-none-"));
    homes.push(home);
    expect(tailscaleInstall({ exists: () => false, env: { PATH: "" }, home, platform: "darwin" })).toBe("none");
    const ran = [];
    const run = async (cli) => { ran.push(cli); return { missing: true, stdout: "" }; };
    expect(await readStatusJson({ run, candidates: tailscaleStatusCandidates(home) })).toBeNull();
    expect(ran).toContain(APP_CLI);
    expect(ran).toContain(`${home}/Applications/Tailscale.app/Contents/MacOS/Tailscale`);
    expect(await createTailnetComputers({ status: async () => readStatusJson({ run }), interfaces: () => ({}), origins: () => [], fetch }).list()).toEqual({ tailscale: "off", computers: [] });
  });
});
