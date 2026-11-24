import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readProfilesState, writeProfilesState } from "./state.ts";
import { appendDecision, flushDecisionLog } from "../decision-log.ts";
import { SessionRegistry } from "../sessions.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { launchRestartableServer, type RestartableServer } from "../testing/restartable-server.ts";

type Rec = Record<string, any>;
const ACME = join(import.meta.dirname, "..", "testing", "fixtures", "profiles", "acme");
const posixOnly = describe.skipIf(process.platform === "win32");
const NOTION_ADD = "Adds MCP server notion at https://mcp.notion.com/mcp, sending header Authorization from your Vault secret NOTION_TOKEN; "
  + "Needs your key: it stays off until you save NOTION_TOKEN in Settings → Vault and apply again";

let server: RestartableServer;
let scratch: string;
let folder: string;
const tokens: Record<string, string> = {};

async function api(method: string, path: string, body?: unknown, as?: string): Promise<{ status: number; body: Rec }> {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) as Rec };
}
const profileBots = async () => ((await api("GET", "/api/bots?messages=0")).body.bots as Rec[]).filter((bot) => bot.profileSource);
const analyst = async () => (await profileBots()).find((bot) => bot.profileSource.key === "analyst");

posixOnly("profile apply routes", () => {
  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), "omb-profiles-apply-"));
    folder = join(scratch, "acme");
    cpSync(ACME, folder, { recursive: true });
    // Codex is listed but not signed in, and has no Accept edits level.
    server = await launchRestartableServer({ instances: { codex: { driver: "codex", displayName: "Codex", config: { cli: join(scratch, "no-codex") } } } });
    await server.stop();
    const registry = new SessionRegistry({ file: join(server.dataDir, "sessions.json"), emailScopes: () => ["client"] });
    tokens.admin = registry.issue({ label: "Owner's laptop", scopes: ["admin", "client"] }).token;
    tokens.member = registry.issue({ label: "Phone", scopes: ["client"] }).token;
    registry.close();
    await server.start();
  }, 90_000);

  afterAll(async () => {
    await server?.close();
    if (scratch) await removeTempDir(scratch);
  });

  it("keeps the chosen folder, and refuses one that is relative, missing or inside the data folder", async () => {
    expect((await api("GET", "/api/profiles")).body).toEqual({ areas: {} });
    expect((await api("PUT", "/api/profiles/folder", { folder: "acme" })).status).toBe(400);
    expect((await api("PUT", "/api/profiles/folder", { folder: join(scratch, "missing") })).status).toBe(400);
    expect((await api("PUT", "/api/profiles/folder", { folder: join(server.dataDir, "profiles") })).body.error).toBe("A profile folder cannot be inside this app's data folder.");
    cpSync(ACME, join(server.dataDir, "acme"), { recursive: true });
    symlinkSync(join(server.dataDir, "acme"), join(scratch, "into-data"));
    expect((await api("PUT", "/api/profiles/folder", { folder: join(scratch, "into-data") })).body.error).toBe("A profile folder cannot be inside this app's data folder.");
    expect((await api("POST", "/api/profiles/plan", { folder: join(scratch, "into-data") })).status).toBe(400);
    expect((await api("GET", "/api/profiles")).body).toEqual({ areas: {} });
    expect((await api("POST", "/api/profiles/plan", {})).body.error).toBe("Choose a profile folder first.");
    const chosen = await api("PUT", "/api/profiles/folder", { folder });
    expect(chosen).toEqual({ status: 200, body: { folder, areas: {} } });
    expect((await api("PUT", "/api/profiles/folder", { folder }, "member")).status).toBe(403);
  });

  it("plans the chosen folder without changing anything", async () => {
    const plan = await api("POST", "/api/profiles/plan", {});
    expect(plan.status).toBe(200);
    expect(plan.body).toMatchObject({ folder, organization: "Acme", noChanges: false, problems: [], counts: { add: 7, access: 5, later: 0 } });
    expect(plan.body.commit).toBeUndefined();
    const closer = plan.body.lines.filter((line: Rec) => line.subject.id === "sales/closer" && line.kind !== "access").map((line: Rec) => line.text);
    expect(closer).toContain("Adds Closer to area Sales (Sales follow-up · codex/gpt-5.5 · Ask)");
    expect(closer).toContain("Closer: Accept edits isn't available for its AI here, so it starts at Ask for approval");
    expect(plan.body.lines.filter((line: Rec) => line.kind === "access").map((line: Rec) => line.text)).toEqual(["Analista BI: Edu brain the shared brain of area bi", "Analista BI: Edu crew on",
      "Reporter: Edu brain the shared brain of area bi", "Closer: Edu brain edu-cloud at https://brain.acme.example/mcp, token from secret EDU_CLOUD_SALES", NOTION_ADD]);
    expect(await profileBots()).toEqual([]);
  });

  it("refuses more access without the plan the person saw, and applies nothing", async () => {
    const blind = await api("POST", "/api/profiles/apply", { giveAccess: true }, "admin");
    expect(blind.status).toBe(400);
    expect(blind.body.error).toBe("Giving more access needs the plan the person saw: send its digest as expect.");
    expect(await profileBots()).toEqual([]);
  });

  it("refuses more access from a program on this computer, and applies nothing", async () => {
    const { digest } = (await api("POST", "/api/profiles/plan", {})).body;
    const refused = await api("POST", "/api/profiles/apply", { giveAccess: true, expect: digest });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("These changes give bots more access, so they have to be confirmed from the desktop app or a paired admin device.");
    expect(refused.body.lines.map((line: Rec) => line.text)).toEqual(["Analista BI: Edu brain the shared brain of area bi", "Analista BI: Edu crew on",
      "Reporter: Edu brain the shared brain of area bi", "Closer: Edu brain edu-cloud at https://brain.acme.example/mcp, token from secret EDU_CLOUD_SALES", NOTION_ADD]);
    expect(await profileBots()).toEqual([]);
    expect((await api("POST", "/api/profiles/apply", { giveAccess: true, expect: digest }, "member")).status).toBe(403);
    expect(await profileBots()).toEqual([]);
  });

  it("refuses a plan that is no longer the one the person saw", async () => {
    const stale = await api("POST", "/api/profiles/apply", { expect: "0".repeat(32) });
    expect(stale.status).toBe(409);
    expect(stale.body.plan.counts.add).toBe(7);
    expect(await profileBots()).toEqual([]);
  });

  it("refuses a plan whose files changed since, even when every line reads the same", async () => {
    const plan = (await api("POST", "/api/profiles/plan", {})).body;
    const file = join(folder, "areas", "bi", "bots", "analyst.md");
    const text = readFileSync(file, "utf8");
    writeFileSync(file, text.replace("Check every number against its source", "Send every number without checking"));
    try {
      const stale = await api("POST", "/api/profiles/apply", { expect: plan.digest });
      expect(stale.status).toBe(409);
      expect(stale.body.plan.lines).toEqual(plan.lines);
      expect(stale.body.plan.digest).not.toBe(plan.digest);
      expect(await profileBots()).toEqual([]);
    } finally {
      writeFileSync(file, text);
    }
  });

  it("applies the rest without the more-access lines, then those from an admin session", async () => {
    const language = (await api("GET", "/api/config")).body.language ?? null;
    expect((await api("PATCH", "/api/config", { language: "es" })).status).toBe(200);
    const plan = (await api("POST", "/api/profiles/plan", {})).body;
    expect(plan.lines.map((line: Rec) => line.text)).toContain("Añade el área BI");
    expect((await api("PATCH", "/api/config", { language })).status).toBe(200);
    const applied = await api("POST", "/api/profiles/apply", { expect: plan.digest });
    expect(applied.status).toBe(200);
    expect(applied.body.applied.skipped.map((line: Rec) => line.text)).toEqual([NOTION_ADD, "Analista BI: Edu brain the shared brain of area bi", "Analista BI: Edu crew on",
      "Reporter: Edu brain the shared brain of area bi", "Closer: Edu brain edu-cloud at https://brain.acme.example/mcp, token from secret EDU_CLOUD_SALES"]);
    expect(applied.body.applied.skipped[0].reason).toContain("desktop app or a paired admin device");
    expect((await profileBots()).map((bot) => bot.name).sort()).toEqual(["Analista BI", "Closer", "Reporter"]);
    expect(await analyst()).toMatchObject({ section: "BI", chiefOfStaff: true, approvalMode: "auto" });
    expect((await analyst())!.eduCrew).not.toBe(true);
    expect((await analyst())!.eduBrain).toBeUndefined();
    expect((await api("GET", "/api/sidebar-sections")).body.sections).toEqual(["BI", "Sales"]);

    const again = (await api("POST", "/api/profiles/plan", {})).body;
    expect(again.lines.filter((line: Rec) => ["add", "change", "access", "conflict"].includes(line.kind)).map((line: Rec) => line.text))
      .toEqual(["Analista BI: Edu brain own → the shared brain of area bi", "Analista BI: Edu crew off → on",
        "Reporter: Edu brain own → the shared brain of area bi", "Closer: Edu brain own → edu-cloud at https://brain.acme.example/mcp, token from secret EDU_CLOUD_SALES", NOTION_ADD]);
    const confirmed = await api("POST", "/api/profiles/apply", { giveAccess: true, expect: again.digest }, "admin");
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.applied.skipped).toEqual([]);
    expect(confirmed.body.applied.lines).toHaveLength(5);
    expect((await api("GET", "/api/mcp/servers")).body.servers).toEqual([expect.objectContaining({ name: "notion", url: "https://mcp.notion.com/mcp", headerKeys: [], enabled: false })]);
    expect((await analyst())!.eduCrew).toBe(true);
    expect((await analyst())!.eduBrain).toEqual({ mode: "area", area: "bi" });
    const settled = (await api("POST", "/api/profiles/plan", {})).body;
    expect(settled.noChanges).toBe(true);
    expect(settled.lines.filter((line: Rec) => line.field === "approval").map((line: Rec) => line.text))
      .toEqual(["Closer: Accept edits isn't available for its AI here, so it stays at Ask for approval"]);
  });

  it("never leaves a bot whose engine has no Accept edits at Full access", async () => {
    const closer = (await profileBots()).find((bot) => bot.profileSource.key === "closer")!;
    expect(closer).toMatchObject({ approvalMode: "ask", modelSelection: { instanceId: "codex", model: "gpt-5.5" } });
    expect((await api("PATCH", `/api/bots/${closer.id}`, { approvalMode: "edits", applyToAllThreads: true })).body.error)
      .toBe("Every thread's provider must support this approval level");
  });

  it("records each apply in the admin activity log and the applied state", async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const activity = (await api("GET", "/api/admin-activity?what=profile", undefined, "admin")).body.entries as Rec[];
    const rows = activity.filter((row) => row.action === "profile.apply");
    expect(rows).toHaveLength(2);
    const bot = (await analyst())!;
    expect(activity).toContainEqual(expect.objectContaining({ botId: bot.id, action: "profile.bot.apply", area: "BI" }));
    expect(rows.find((row) => row.changed?.includes("bi/analyst.eduCrew") && row.changed.includes("sales/closer.eduBrain") && row.changed.includes("mcp/notion") && row.changed.length === 5)).toBeTruthy();
    expect(rows.find((row) => row.changed?.includes("sales/closer.connectors"))?.after).toMatchObject({ folder });
    const status = (await api("GET", "/api/profiles")).body;
    expect(status).toMatchObject({ folder, applied: { folder, digest: expect.any(String) }, areas: { bi: { section: "BI" }, sales: { section: "Sales" } } });
  });

  it("stores the stricter ceiling and refuses bot, thread and creation writes above it", async () => {
    const bot = (await analyst())!;
    expect(bot.approvalCeiling).toBe("auto");
    expect(JSON.parse(readFileSync(join(server.dataDir, "profiles.json"), "utf8")).areas).toMatchObject({
      bi: { maxApproval: "auto" }, sales: { maxApproval: "edits" },
    });
    const refusal = { status: 403, body: { error: "This area allows at most Approve for me", errorKey: "serverError.approval.ceiling.auto" } };
    expect(await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: "full" })).toEqual(refusal);
    expect(await api("PATCH", `/api/bots/${bot.id}/tasks/${bot.threadId}`, { approvalMode: "full" })).toEqual(refusal);
    expect(await api("POST", "/api/bots", { name: "Outside analyst", section: "BI", settings: { approvalMode: "full" } })).toEqual(refusal);
    expect(await api("POST", "/api/bots", { name: "Local analyst", section: "BI", settings: { approvalMode: "ask" } })).toMatchObject({
      status: 201, body: { bot: { approvalMode: "ask", approvalCeiling: "auto" } },
    });
  });

  it("refuses to apply a profile above the ceiling before writing it", async () => {
    const file = join(folder, "areas", "sales", "bots", "closer.md");
    const text = readFileSync(file, "utf8");
    writeFileSync(file, text.replace("approval: edits", "approval: full"));
    try {
      const applied = await api("POST", "/api/profiles/apply", {}, "admin");
      expect(applied).toMatchObject({ status: 403, body: { error: "This area allows at most Auto-accept edits" } });
      expect((await profileBots()).find((bot) => bot.profileSource.key === "closer")?.approvalMode).toBe("ask");
    } finally {
      writeFileSync(file, text);
    }
  });

  it("filters activity and decisions by bot and the bot's current department", async () => {
    const bot = (await analyst())!;
    const closer = (await profileBots()).find((one) => one.profileSource.key === "closer")!;
    for (const one of [bot, closer]) appendDecision(server.dataDir, {
      botId: one.id, threadId: one.threadId, botName: one.name, decision: "auto-approved", source: "app-settings",
    });
    await flushDecisionLog(server.dataDir);
    const query = `bot=${bot.id}&area=bi`;
    const activity = await api("GET", `/api/admin-activity?what=profile&${query}`, undefined, "admin");
    expect(activity.status).toBe(200);
    expect(activity.body.entries).toHaveLength(2);
    expect(activity.body.entries.every((row: Rec) => row.botId === bot.id && row.area === "BI")).toBe(true);
    const sales = (await api("GET", "/api/admin-activity?what=profile&area=Sales", undefined, "admin")).body.entries;
    expect(sales).toContainEqual(expect.objectContaining({ botId: closer.id, area: "Sales" }));
    expect(sales.every((row: Rec) => row.botId === closer.id && row.area === "Sales")).toBe(true);
    expect((await api("GET", `/api/decisions?limit=1&${query}`, undefined, "admin")).body.decisions).toMatchObject([{ botId: bot.id }]);
    expect((await api("GET", `/api/decisions?bot=${bot.id}&area=Sales`, undefined, "admin")).body.decisions).toEqual([]);
    const csv = await fetch(`${server.url}/api/admin-activity.csv?what=profile&${query}`, { headers: { authorization: `Bearer ${tokens.admin}` } });
    expect(await csv.text()).toContain(bot.name);
  });

  it("follows a department renamed by an admin, so the next plan keeps it instead of making another", async () => {
    expect((await api("PATCH", "/api/sidebar-sections?section=BI", { name: "Analytics" }, "admin")).status).toBe(200);
    expect((await api("GET", "/api/profiles")).body.areas.bi).toEqual({ section: "Analytics" });
    const plan = (await api("POST", "/api/profiles/plan", {})).body;
    expect(plan.lines.filter((line: Rec) => line.kind === "add")).toEqual([]);
    expect(plan.lines.filter((line: Rec) => line.kind === "changed-here").map((line: Rec) => line.text)).toEqual(["Area BI: its department was renamed here to Analytics, so that name is kept"]);
    expect((await api("GET", "/api/sidebar-sections")).body.sections).toEqual(["Analytics", "Sales"]);
  });

  it("tells bot settings which fields were changed here and which keys the bot needs, never a key's value", async () => {
    const bots = await profileBots();
    const closer = bots.find((bot) => bot.profileSource.key === "closer")!;
    const reporter = bots.find((bot) => bot.profileSource.key === "reporter")!;
    expect((await api("GET", `/api/profiles/bots/${closer.id}`)).body).toEqual({
      changedHere: [], secrets: [{ kind: "secret", name: "EDU_CLOUD_SALES", for: "Edu brain" }, { kind: "secret", name: "NOTION_TOKEN", for: "notion" }],
    });
    expect((await api("PATCH", `/api/bots/${reporter.id}`, { title: "Writes the weekly report", soul: "Changed here." })).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${reporter.id}`, { description: "Left to the app by its file." })).status).toBe(200);
    expect((await api("GET", `/api/profiles/bots/${reporter.id}`)).body.changedHere).toEqual(["title", "soul"]);
    const analyst = bots.find((bot) => bot.profileSource.key === "analyst")!;
    expect((await api("PATCH", `/api/bots/${analyst.id}`, { chiefOfStaff: false })).status).toBe(200);
    expect((await api("GET", `/api/profiles/bots/${analyst.id}`)).body.changedHere).toEqual(["chief"]);
    expect((await api("GET", `/api/profiles/bots/${reporter.id}`, undefined, "member")).status).toBe(403);
    expect((await api("GET", "/api/profiles/bots/no-such-bot")).status).toBe(404);
  });
  it("combines a stamped bot's source ceiling with its stricter destination and persists the downgrade", async () => {
    const before = readProfilesState(server.dataDir);
    const closer = (await profileBots()).find((bot) => bot.profileSource.key === "closer")!;
    const path = `/api/bots/${closer.id}`;
    const section = before.areas.bi!.section;
    writeProfilesState(server.dataDir, { ...before, areas: { ...before.areas,
      bi: { ...before.areas.bi!, maxApproval: "ask" }, sales: { ...before.areas.sales!, maxApproval: undefined } } });
    try {
      expect((await api("PATCH", path, { approvalMode: "full" })).status).toBe(200);
      expect(await api("PATCH", path, { section })).toMatchObject({
        status: 200, body: { bot: { section, approvalMode: "ask", approvalCeiling: "ask", profileSource: { area: "sales" } } },
      });
      const saved = JSON.parse(readFileSync(join(server.dataDir, "bots.json"), "utf8")) as Rec[];
      expect(saved.find((bot) => bot.id === closer.id)).toMatchObject({ section, approvalMode: "ask" });
      expect((await api("PATCH", path, { section: null })).status).toBe(403);
    } finally {
      await api("PATCH", path, { section: closer.section, approvalMode: "ask" }, "admin");
      writeProfilesState(server.dataDir, before);
    }
  });

  it("requires a paired admin to leave or remove a capped department through any membership route", async () => {
    const bot = (await api("POST", "/api/bots", { name: "Capped member", section: "Analytics", settings: { approvalMode: "ask" } })).body.bot;
    const path = `/api/bots/${bot.id}`;
    const areas = "/api/sidebar-sections";
    const section = `${areas}?section=Analytics`;
    try {
      expect((await api("PATCH", path, { section: null })).status).toBe(403);
      expect((await api("PUT", section, { addBotIds: [], removeBotIds: [bot.id] })).status).toBe(403);
      expect((await api("POST", areas, { name: "", botIds: [bot.id] })).status).toBe(403);
      expect((await api("DELETE", section)).status).toBe(403);
      expect((await api("PATCH", section, { name: "Elsewhere" })).status).toBe(403);
      expect((await api("PATCH", path, { approvalMode: "full" })).status).toBe(403);
      expect(await api("PATCH", path, { section: null }, "admin")).toMatchObject({ status: 200, body: { bot: { approvalMode: "ask" } } });
    } finally {
      await api("DELETE", path, undefined, "admin");
    }
  });

  it("lists profile and bot-api among accepted activity categories", async () => {
    const result = await api("GET", "/api/admin-activity?what=unknown", undefined, "admin");
    expect(result.status).toBe(400);
    expect(result.body.error).toContain("bot-api");
    expect(result.body.error).toContain("profile");
  });

});
