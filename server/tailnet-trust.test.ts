import type { IncomingMessage } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LOCKOUT, SessionRegistry } from "./sessions.ts";
import { createTailnetSignIn, readTailnetSignIn, tailnetCallerTrusted, tailscaleReader, type TailscaleReader } from "./tailnet-trust.ts";
import { fakeTailscale, tailnetStatus, tailnetWhois } from "./testing/fake-tailscale.ts";

const CALLER = "100.100.2.2";
const status = (over: Parameters<typeof tailnetStatus>[0] = {}) => JSON.stringify(tailnetStatus(over));
const whois = (over: Parameters<typeof tailnetWhois>[0] = {}) => JSON.stringify(tailnetWhois(over));

describe("tailnetCallerTrusted", () => {
  it("trusts another untagged node of the same Tailscale login", () => {
    expect(tailnetCallerTrusted(status(), whois(), CALLER)).toEqual({ ok: true, node: { stableId: "nLAPTOP2CNTRL", name: "laptop" } });
    expect(tailnetCallerTrusted(status(), whois(), `::ffff:${CALLER}`).ok, "an IPv4-mapped peer address is the same address").toBe(true);
  });

  it("compares logins without case", () => {
    expect(tailnetCallerTrusted(status({ login: "Eduardo@Example.com" }), whois({ login: "eduardo@EXAMPLE.com" }), CALLER).ok).toBe(true);
  });

  it("refuses another login", () => {
    expect(tailnetCallerTrusted(status(), whois({ login: "someone@example.com" }), CALLER)).toEqual({ ok: false, reason: "the caller belongs to another Tailscale account" });
    expect(tailnetCallerTrusted(status(), whois({ login: "" }), CALLER).ok).toBe(false);
    expect(tailnetCallerTrusted(status({ login: "" }), whois({ login: "" }), CALLER), "two empty logins are not the same owner").toEqual({ ok: false, reason: "this computer's Tailscale owner is unknown" });
  });

  it("refuses a tagged node, even with the owner's login", () => {
    expect(tailnetCallerTrusted(status(), whois({ tags: ["tag:server"] }), CALLER)).toEqual({ ok: false, reason: "the caller is a tagged node" });
    const garbledTags = { ...tailnetWhois(), Node: { ...tailnetWhois().Node, Tags: "tag:server" } };
    expect(tailnetCallerTrusted(status(), JSON.stringify(garbledTags), CALLER).ok).toBe(false);
    expect(tailnetCallerTrusted(status(), whois({ tags: [] }), CALLER).ok, "no tags at all").toBe(true);
  });

  it("refuses a node shared in from another tailnet", () => {
    expect(tailnetCallerTrusted(status(), whois({ sharer: 9001 }), CALLER)).toEqual({ ok: false, reason: "the caller is shared from another tailnet" });
  });

  it("refuses this computer's own node", () => {
    expect(tailnetCallerTrusted(status({ selfId: "nLAPTOP2CNTRL" }), whois(), CALLER)).toEqual({ ok: false, reason: "the caller is this computer" });
    expect(tailnetCallerTrusted(status({ ips: [CALLER] }), whois(), CALLER)).toEqual({ ok: false, reason: "the caller is this computer" });
  });

  it("refuses an answer about another address", () => {
    expect(tailnetCallerTrusted(status(), whois({ address: "100.100.3.3" }), CALLER)).toEqual({ ok: false, reason: "Tailscale names another address for the caller" });
  });

  it("refuses missing or garbled answers", () => {
    for (const [statusJson, whoisJson] of [[null, whois()], [status(), null], ["", whois()], [status(), "not json"], ["[]", whois()], [status(), "{}"], ["{\"Self\":{}}", whois()], [status(), "{\"Node\":{},\"UserProfile\":{}}"]] as const) {
      expect(tailnetCallerTrusted(statusJson, whoisJson, CALLER).ok, `${statusJson} / ${whoisJson}`).toBe(false);
    }
    const noStableId = { ...tailnetWhois(), Node: { ...tailnetWhois().Node, StableID: undefined } };
    expect(tailnetCallerTrusted(status(), JSON.stringify(noStableId), CALLER).ok).toBe(false);
    expect(tailnetCallerTrusted(status(), whois(), "").ok).toBe(false);
  });
});

describe("readTailnetSignIn", () => {
  it("takes a computer's name, cleaned and capped, and an optional cookie", () => {
    expect(readTailnetSignIn({ label: "  Windows\u0007 PC‮ ", platform: "win32" })).toEqual({ label: "Windows PC", cookie: false });
    expect(readTailnetSignIn({ label: "Mac", cookie: true })).toEqual({ label: "Mac", cookie: true });
    expect(readTailnetSignIn({ label: "x".repeat(200) })?.label).toHaveLength(60);
  });

  it("refuses anything else", () => {
    for (const body of [null, [], "Mac", {}, { label: "" }, { label: " \u0007 " }, { label: 3 }, { label: "Mac", platform: "android" }, { label: "Mac", cookie: "yes" }]) {
      expect(readTailnetSignIn(body), JSON.stringify(body)).toBeNull();
    }
  });
});

describe("tailscaleReader", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "omb-tailnet-trust-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("asks only read-only questions of the first CLI that is there, never through a shell", async () => {
    const fake = fakeTailscale({ under: dir });
    fake.status(tailnetStatus());
    fake.whois({ [CALLER]: tailnetWhois() });
    const reader = tailscaleReader([join(dir, "missing-tailscale"), fake.cli]);
    expect(JSON.parse((await reader.status())!)).toEqual(tailnetStatus());
    expect(JSON.parse((await reader.whois(CALLER))!)).toEqual(tailnetWhois());
    expect(await reader.whois("100.100.9.9; rm -rf /")).toBe("");
    expect(fake.calls()).toEqual([["status", "--json"], ["whois", "--json", CALLER], ["whois", "--json", "100.100.9.9; rm -rf /"]]);
    expect(await tailscaleReader([join(dir, "missing-tailscale")]).status()).toBeNull();
  });
});

describe("createTailnetSignIn", () => {
  let dir: string;
  let sessions: SessionRegistry;
  let answers: { status: string | null; whois: Record<string, string> };
  let asked: string[];
  const tailscale: TailscaleReader = { status: async () => answers.status, whois: async (address) => { asked.push(address); return answers.whois[address] ?? null; } };
  const lines: string[] = [];
  const peer = (remoteAddress: string | undefined, headers: Record<string, string> = {}) => ({ socket: { remoteAddress, remoteFamily: "IPv4" }, headers }) as unknown as IncomingMessage;
  const signInWith = (over: Partial<Parameters<typeof createTailnetSignIn>[0]> = {}) =>
    createTailnetSignIn({ sessions, tailscale, arrivedOnTailnet: () => true, unavailable: null, log: (line) => lines.push(line), ...over });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omb-tailnet-trust-"));
    sessions = new SessionRegistry({ file: join(dir, "sessions.json") });
    answers = { status: status(), whois: { [CALLER]: whois() } };
    asked = [];
    lines.length = 0;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("gives the owner's other computer the session a pairing gives (admin and client), and only one per computer", async () => {
    const signIn = signInWith();
    const first = await signIn(peer(CALLER), "Windows PC");
    expect(first).toMatchObject({ ok: true, session: { label: "Windows PC (Tailscale)", scopes: ["admin", "client"] } });
    if (!first.ok) throw new Error("refused");
    expect(sessions.authenticate(first.token)?.id).toBe(first.session.id);

    const second = await signIn(peer(`::ffff:${CALLER}`), "Windows PC");
    if (!second.ok) throw new Error("refused");
    expect(sessions.authenticate(second.token)?.id).toBe(second.session.id);
    expect(sessions.authenticate(first.token), "the earlier session of the same computer ends").toBeNull();
    expect(asked).toEqual([CALLER, CALLER]);

    answers.whois["100.100.3.3"] = whois({ address: "100.100.3.3", stableId: "nOTHER3CNTRL" });
    const other = await signIn(peer("100.100.3.3"), "Mac");
    expect(other.ok).toBe(true);
    expect(sessions.authenticate(second.token), "another computer's session is its own").not.toBeNull();
  });

  it("refuses what did not arrive straight from a tailnet peer on the tailnet listener, without asking Tailscale", async () => {
    const refusals = [
      [signInWith({ arrivedOnTailnet: () => false }), peer(CALLER)],
      [signInWith(), peer("127.0.0.1")],
      [signInWith(), peer("::1")],
      [signInWith(), peer(undefined)],
      [signInWith(), peer("192.168.1.20")],
      [signInWith(), peer(CALLER, { "x-forwarded-for": "100.100.2.2" })],
      [signInWith(), peer(CALLER, { forwarded: "for=100.100.2.2" })],
      [signInWith(), peer(CALLER, { "x-real-ip": "100.100.2.2" })],
      [signInWith(), peer(CALLER, { "tailscale-user-login": "eduardo@example.com", "x-forwarded-for": "100.100.2.2" })],
    ] as const;
    for (const [signIn, req] of refusals) {
      expect(await signIn(req, "PC"), JSON.stringify({ remote: req.socket.remoteAddress, headers: req.headers })).toMatchObject({ ok: false, status: 403, code: "tailnet_not_direct" });
    }
    expect(asked).toEqual([]);
    expect(lines[0]).toMatch(/^tailnet sign-in refused from 100\.100\.2\.2: only another computer/);
  });

  it("takes a test rig's stand-in address as a tailnet one", async () => {
    answers.whois["192.168.1.20"] = whois({ address: "192.168.1.20" });
    expect((await signInWith({ standIn: "192.168.1.20" })(peer("192.168.1.20"), "PC")).ok).toBe(true);
  });

  it("is refused outright where it never applies", async () => {
    expect(await signInWith({ unavailable: "A Cloud home does not take sign-ins from Tailscale." })(peer(CALLER), "PC"))
      .toEqual({ ok: false, status: 403, code: "tailnet_unavailable", error: "A Cloud home does not take sign-ins from Tailscale." });
    expect(asked).toEqual([]);
  });

  it("refuses a caller Tailscale does not vouch for, logs why, and locks out a caller that keeps trying", async () => {
    answers.whois[CALLER] = whois({ login: "someone@example.com" });
    const signIn = signInWith();
    expect(await signIn(peer(CALLER), "PC")).toMatchObject({ ok: false, status: 403, code: "tailnet_not_trusted" });
    expect(lines.at(-1)).toBe("tailnet sign-in refused from 100.100.2.2: the caller belongs to another Tailscale account");
    answers.status = null;
    expect(await signIn(peer(CALLER), "PC")).toMatchObject({ ok: false, status: 403, code: "tailnet_not_trusted" });
    for (let attempt = 2; attempt < LOCKOUT.failures; attempt++) await signIn(peer(CALLER), "PC");
    const callsBefore = asked.length;
    answers = { status: status(), whois: { [CALLER]: whois() } };
    expect(await signIn(peer(CALLER), "PC")).toMatchObject({ ok: false, status: 429, code: "tailnet_too_many", retryAfterMs: expect.any(Number) });
    expect(asked).toHaveLength(callsBefore);
  });
});
