import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { memberAudience, roomAudience, TEAM_AUDIENCE } from "./audience.ts";
import type { InstanceConfigMap, ProviderSnapshot } from "./contracts.ts";
import { audienceHome } from "./engine-homes/layout.ts";
import { accountReadableFrom, engineLimitsFor, type EngineLimitInstance } from "./engine-limits.ts";
import type { EngineLimit } from "../shared/limit-reset.ts";
import type { PlanProviderRow, PlanUsageReport } from "./plan-usage.ts";
import { createEngineLimitsRoutes, ENGINE_LIMITS_GUEST } from "./routes/engine-limits.ts";
import { PASS } from "./routes/table.ts";

const DATA = "/data";
const AT = "2026-11-02T10:00:00.000Z";
const closed = { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };
const open = (used: number, resetsAt: string | null = "2026-11-02T12:00:00.000Z") => ({ available: true, usedPercent: used, remainingPercent: 100 - used, resetsAt });
const row = (id: string, extra: Partial<PlanProviderRow> = {}): PlanProviderRow => ({
  id, name: id, driver: "codex", plan: "plus", ok: true, error: null, fiveHour: open(40.25), weekly: open(70), extra: [], models: [], ...extra,
});
const instance = (instanceId: string, driverKind = "codex", displayName: string | undefined = "Codex", enabled = true): EngineLimitInstance => ({ instanceId, driverKind, displayName, enabled });
const ready: ProviderSnapshot = { state: "available", authenticated: true, billing: "subscription" };
const report = (...providers: PlanProviderRow[]): PlanUsageReport => ({ fetchedAt: AT, providers });
const read = (input: Partial<Parameters<typeof engineLimitsFor>[0]> & { instances: EngineLimitInstance[] }) => engineLimitsFor({
  configs: {}, status: () => ready, report: report(), turn: TEAM_AUDIENCE, dataDir: DATA, ...input,
});

describe("usage limits a bot reads", () => {
  it("gives percent, reset and when it was checked, for every window the account reports", () => {
    const [account] = read({
      instances: [instance("codex")],
      report: report(row("codex", {
        extra: [{ label: "Code review", usedPercent: 5, remainingPercent: 95, resetsAt: null }],
        models: [{ name: "GPT-5 Codex", windows: [{ label: "Weekly", usedPercent: 80, remainingPercent: 20, resetsAt: AT }] }],
      })),
    });
    expect(account).toEqual({
      account: "Codex", engine: "codex", status: "ok", plan: "plus", checkedAt: AT,
      windows: [
        { name: "5-hour", usedPercent: 40.3, resetsAt: "2026-11-02T12:00:00.000Z" },
        { name: "weekly", usedPercent: 70, resetsAt: "2026-11-02T12:00:00.000Z" },
        { name: "Code review", usedPercent: 5, resetsAt: null },
        { name: "GPT-5 Codex Weekly", usedPercent: 80, resetsAt: AT },
      ],
    });
  });

  it("names Antigravity's leading windows as Gemini's, and says its limits could not be checked when it has no row", () => {
    const antigravity = instance("antigravity", "antigravityAgent", "Antigravity");
    const [account] = read({
      instances: [antigravity],
      report: report(row("antigravity", { driver: "antigravity", plan: null,
        models: [{ name: "Claude & GPT (shared)", windows: [{ label: "5-hour", usedPercent: 56, remainingPercent: 44, resetsAt: AT }] }] })),
    });
    expect(account).toMatchObject({ status: "ok", windows: [
      { name: "Gemini 5-hour", usedPercent: 40.3 }, { name: "Gemini weekly", usedPercent: 70 }, { name: "Claude & GPT (shared) 5-hour", usedPercent: 56 },
    ] });
    expect(read({ instances: [antigravity] })).toEqual([
      { account: "Antigravity", engine: "antigravityAgent", status: "unknown", checkedAt: AT, windows: [], why: "Usage could not be checked just now. Try again later." },
    ]);
    expect(read({ instances: [antigravity], status: () => ({ ...ready, authenticated: false }) })).toEqual([]);
    expect(read({ instances: [instance("codex")], report: report(row("codex")) })[0]!.windows[0]!.name).toBe("5-hour");
  });

  it("tells unknown from unsupported", () => {
    const accounts = read({
      instances: [instance("signed-out", "codex", "Signed out"), instance("quiet", "codex", "Quiet"), instance("cursor", "cursorAgent", "Cursor"), instance("key", "claudeAgent", "Key")],
      status: (id) => id === "key" ? { ...ready, billing: "metered" } : ready,
      report: report(
        row("signed-out", { ok: false, error: "Sign in again in Codex", fiveHour: closed, weekly: closed }),
        row("quiet", { fiveHour: closed, weekly: closed, plan: null }),
        row("key"),
      ),
    });
    expect(accounts.map(({ account, status, checkedAt, windows, why }) => ({ account, status, checkedAt, windows: windows.length, why }))).toEqual([
      { account: "Signed out", status: "unknown", checkedAt: AT, windows: 0, why: "Sign in again in Codex" },
      { account: "Quiet", status: "unknown", checkedAt: AT, windows: 0, why: "The account answered but reported no usage windows." },
      { account: "Cursor", status: "unsupported", checkedAt: null, windows: 0, why: "This AI does not report usage limits to this app." },
      { account: "Key", status: "unsupported", checkedAt: null, windows: 0, why: "This AI does not report usage limits to this app." },
    ]);
  });

  it("lists an OpenCode Go account's allowance like the other plans", () => {
    const [account] = read({
      instances: [instance("oc", "opencodeGo", "OpenCode")],
      report: report(row("oc", { driver: "opencode", plan: "Go", fiveHour: open(30), weekly: open(55) })),
    });
    expect(account).toMatchObject({ account: "OpenCode", engine: "opencodeGo", status: "ok", plan: "Go" });
    expect(account?.windows.map((window) => window.name)).toEqual(["5-hour", "weekly"]);
  });

  it("says unknown, not unsupported, when the read itself failed", () => {
    expect(read({ instances: [instance("codex"), instance("cursor", "cursorAgent", "Cursor")], report: null }).map((account) => account.status)).toEqual(["unknown", "unsupported"]);
  });

  it("leaves out an engine that is off, not installed, or a signed-out one that reports nothing", () => {
    const accounts = read({
      instances: [instance("off", "claudeAgent", "Off", false), instance("missing"), instance("cursor", "cursorAgent", "Cursor")],
      status: (id) => id === "missing" ? { state: "unavailable", reason: "no CLI" } : id === "cursor" ? { ...ready, authenticated: false } : ready,
      report: report(row("off"), row("missing")),
    });
    expect(accounts).toEqual([]);
  });

  it("gives Claude only what its CLI reported: the refusal holding it, else nothing", () => {
    const claude = instance("claude", "claudeAgent", "Claude");
    const stray = report(row("claude", { driver: "claude" }));
    expect(read({ instances: [claude], report: stray })).toEqual([
      { account: "Claude", engine: "claudeAgent", status: "unknown", checkedAt: null, windows: [], why: "Claude Code reports a limit only when a turn reaches it, and none is reached now." },
    ]);
    const resetsAt = Date.parse(AT) + 3_600_000;
    const held = vi.fn((_id: string): EngineLimit => ({ engine: "claude", name: "Claude", driver: "claude", window: null, usedPercent: 100, resetsAt, blocked: true, held: true }));
    expect(read({ instances: [claude], report: null, held })).toEqual([
      { account: "Claude", engine: "claudeAgent", status: "ok", checkedAt: null, windows: [{ name: "usage", usedPercent: 100, resetsAt: new Date(resetsAt).toISOString() }] },
    ]);
    expect(held).toHaveBeenCalledWith("claude");
    expect(read({ instances: [claude], held: () => ({ ...held("claude"), window: "weekly", resetsAt: null }) })[0]!.windows).toEqual([{ name: "weekly", usedPercent: 100, resetsAt: null }]);
    expect(read({ instances: [claude], status: () => ({ ...ready, billing: "metered" }), held })[0]).toMatchObject({ status: "unsupported" });
  });

  it("carries no credential, account id, sign-in folder or address", () => {
    const secret = "sk-ant-oat01-secret";
    const text = JSON.stringify(read({
      instances: [instance("claude-5f1c9a", "claudeAgent", "ada@example.com"), instance("second", "claudeAgent", "ada@example.com")],
      configs: { "claude-5f1c9a": { driver: "claudeAgent", environment: { ANTHROPIC_API_KEY: secret }, config: { configDir: "/home/ada/.claude-work" } } },
      status: () => ({ ...ready, account: { email: "ada@example.com", organization: "Acme" } }),
      report: report(row("claude-5f1c9a"), row("second")),
    }));
    for (const leak of [secret, "claude-5f1c9a", ".claude-work", "@", "Acme"]) expect(text).not.toContain(leak);
    expect(JSON.parse(text).map((account: { account: string }) => account.account)).toEqual(["claudeAgent", "claudeAgent 2"]);
  });
});

describe("a Team Cloud's audience rule", () => {
  const ada = memberAudience("ada"), bob = memberAudience("bob");
  const adaHome = audienceHome(DATA, ada);
  const inHome: InstanceConfigMap[string] = { driver: "claudeAgent", config: { configDir: join(adaHome, ".claude") } };
  const inEnv: InstanceConfigMap[string] = { driver: "codex", environment: { CODEX_HOME: join(adaHome, ".codex") } };
  const inPeople: InstanceConfigMap[string] = { driver: "claudeAgent", config: { configDir: join(DATA, "people", "ada", "claude") } };

  it("a member's turn reads their own account and the team's, never another member's", () => {
    for (const entry of [inHome, inEnv, inPeople]) {
      expect(accountReadableFrom(entry, ada, DATA)).toBe(true);
      expect(accountReadableFrom(entry, bob, DATA)).toBe(false);
      expect(accountReadableFrom(entry, TEAM_AUDIENCE, DATA)).toBe(false);
      expect(accountReadableFrom(entry, roomAudience("r1"), DATA)).toBe(false);
    }
    const team: InstanceConfigMap[string] = { driver: "claudeAgent", config: { configDir: join(audienceHome(DATA, TEAM_AUDIENCE), ".claude") } };
    expect(accountReadableFrom(team, bob, DATA)).toBe(true);
    expect(accountReadableFrom({ driver: "claudeAgent" }, bob, DATA)).toBe(true);
    expect(accountReadableFrom(undefined, bob, DATA)).toBe(true);
  });

  it("leaves another member's account out of what a bot reads", () => {
    const instances = [instance("ada", "claudeAgent", "Ada's Claude"), instance("team", "claudeAgent", "Team Claude")];
    const configs = { ada: inHome, team: { driver: "claudeAgent" } } as InstanceConfigMap;
    const input = { instances, configs, report: report(row("ada"), row("team")) };
    expect(read({ ...input, turn: bob }).map((account) => account.account)).toEqual(["Team Claude"]);
    expect(read({ ...input, turn: ada }).map((account) => account.account)).toEqual(["Ada's Claude", "Team Claude"]);
  });
});

describe("the internal route", () => {
  const route = (over: Partial<Parameters<typeof createEngineLimitsRoutes>[0]> = {}) => {
    const load = vi.fn(async () => report(row("codex")));
    const deps = { instances: () => [instance("codex")], configs: () => ({ codex: { driver: "codex" } }) as InstanceConfigMap, status: () => ready, load, audienceOf: () => TEAM_AUDIENCE, guestDriven: () => false, dataDir: DATA, ...over };
    return { load, run: createEngineLimitsRoutes(deps) };
  };
  const call = async (run: ReturnType<typeof route>["run"], method = "GET", path = "/api/internal/engine-limits") => {
    const json = vi.fn();
    const passed = await run({ method, path, res: {} as never, json: json as never, threadId: "t" });
    return { passed, status: json.mock.calls[0]?.[1], body: json.mock.calls[0]?.[2] as { text?: string; error?: string } | undefined };
  };

  it("answers the accounts as text the tool hands to the bot", async () => {
    const { run, load } = route();
    const { status, body } = await call(run);
    expect(status).toBe(200);
    expect(JSON.parse(body!.text!).accounts[0]).toMatchObject({ account: "Codex", status: "ok" });
    expect(load).toHaveBeenCalledWith([expect.objectContaining({ id: "codex", driver: "codex" })]);
  });

  it("refuses a turn someone else started, without reading anything", async () => {
    const { run, load } = route({ guestDriven: () => true });
    const { status, body } = await call(run);
    expect(status).toBe(403);
    expect(body?.error).toBe(ENGINE_LIMITS_GUEST);
    expect(load).not.toHaveBeenCalled();
  });

  it("a failed read still answers, as unknown", async () => {
    const { run } = route({ load: async () => { throw new Error("offline"); } });
    const { body } = await call(run);
    expect(JSON.parse(body!.text!).accounts[0]).toMatchObject({ status: "unknown", checkedAt: null });
  });

  it("leaves other paths and methods alone", async () => {
    const { run } = route();
    expect((await call(run, "POST")).passed).toBe(PASS);
    expect((await call(run, "GET", "/api/internal/other")).passed).toBe(PASS);
  });
});
