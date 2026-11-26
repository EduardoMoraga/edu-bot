import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { describe, expect, it } from "vitest";

import { checkProfileFiles, type ResolvedBot } from "../../shared/profile-format.ts";
import { allowsTool } from "../../shared/tool-scope.ts";
import type { ProfileSource } from "../../shared/wire.ts";
import type { RequestAuth } from "../request-auth.ts";
import { mayGiveProfileAccess } from "../routes/profiles.ts";
import { applyProfilePlan } from "./apply.ts";
import { botApprovalRefusal } from "./bot-write.ts";
import { profileFilesHash } from "./load.ts";
import { planProfiles, type AppView } from "./plan.ts";
import type { ProfilesState } from "./state.ts";

const ORG = `---
edubot: 1
kind: organization
name: Acme
maxApproval: edits
defaults:
  approval: ask
---
Acme.
`;

const area = (key: string, name: string, extra: string, brief: string) => `---
edubot: 1
kind: area
key: ${key}
name: ${name}
${extra}---
${brief}
`;

const botFile = (key: string, name: string) => `---
edubot: 1
kind: bot
key: ${key}
name: ${name}
---
You work in your own area.
`;

const BI_TOOLS = `maxApproval: ask
defaults:
  tools: { allow: ["mcp:edu:edu_recall", "mcp:data:data_sql"] }
`;

const SALES_TOOLS = `defaults:
  approval: edits
  tools: { allow: ["mcp:gmail:GMAIL_FETCH_EMAILS"] }
`;

function files(edits: Record<string, string> = {}) {
  const base: Record<string, string> = {
    "org.md": ORG,
    "areas/bi/area.md": area("bi", "BI", BI_TOOLS, "Numbers come from the BI tools."),
    "areas/bi/bots/analyst.md": botFile("analyst", "Analyst"),
    "areas/sales/area.md": area("sales", "Sales", SALES_TOOLS, "Follow up leads."),
    "areas/sales/bots/closer.md": botFile("closer", "Closer"),
  };
  const merged = { ...base, ...edits };
  const list = Object.entries(merged).map(([path, text]) => ({ path, text }));
  return { ...checkProfileFiles(list), root: "/profiles/acme", contentHash: profileFilesHash(list) };
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function app() {
  const state = {
    mcp: {} as Record<string, Record<string, unknown>>,
    bots: [] as Array<Record<string, unknown>>,
    sections: [] as string[],
    briefs: {} as Record<string, string>,
    skills: {} as Record<string, Record<string, { text: string; enabled: boolean }>>,
    areas: { version: 1, areas: {}, mcpServers: {} } as ProfilesState,
  };
  let ids = 0;
  const port = {
    async call(method: string, path: string, body: Record<string, unknown> = {}) {
      const url = new URL(path, "http://app");
      if (url.pathname === "/api/sidebar-sections" && method === "POST") { state.sections.push(String(body.name)); return { status: 200, body: {} }; }
      if (url.pathname === "/api/section-context") { state.briefs[url.searchParams.get("section")!] = String(body.text); return { status: 200, body: {} }; }
      if (url.pathname === "/api/bots" && method === "POST") {
        const settings = body.settings as { approvalMode?: string } | undefined;
        const made = { id: `bot-${++ids}`, name: body.name, section: body.section, ...(settings?.approvalMode ? { approvalMode: settings.approvalMode } : {}) };
        state.bots.push(made);
        return { status: 200, body: { bot: made } };
      }
      const parts = url.pathname.split("/").filter(Boolean);
      const found = state.bots.find((candidate) => candidate.id === parts[2]);
      if (!found) return { status: 404, body: { error: `no route ${method} ${path}` } };
      if (parts.length === 3 && method === "PATCH") { Object.assign(found, body); return { status: 200, body: { bot: found } }; }
      if (parts[3] === "skill-template") {
        (state.skills[String(found.id)] ??= {})[String(body.name)] = { text: String(body.text), enabled: Boolean(body.enabled) };
        return { status: 201, body: {} };
      }
      return { status: 404, body: { error: `no route ${method} ${path}` } };
    },
    stamp(botId: string, source: ProfileSource) { state.bots.find((bot) => bot.id === botId)!.profileSource = source; },
  };
  const view = (): AppView => ({
    bots: state.bots, sections: state.sections, briefs: state.briefs,
    skills: Object.fromEntries(Object.entries(state.skills).map(([id, skills]) => [id, Object.entries(skills).map(([name, skill]) => ({ name, enabled: skill.enabled, sha256: sha(skill.text) }))])),
    instances: [{ instanceId: "claude", driverKind: "claudeAgent", models: ["claude-sonnet-5-5"] }],
    mcpServers: state.mcp, vaultSecrets: {},
  });
  const plan = (profiles = files()) => planProfiles({ folder: profiles, app: view(), state: state.areas });
  const apply = async (profiles = files(), giveAccess = true) => {
    const planned = plan(profiles);
    const outcome = await applyProfilePlan(planned, state.areas.areas, port, { giveAccess, now: 1, folderName: "acme" });
    state.areas = { ...state.areas, areas: outcome.areas, mcpServers: outcome.mcpServers };
    return { planned, outcome };
  };
  const saved = (id: string) => state.bots.find((candidate) => {
    const source = candidate.profileSource as { area?: string; key?: string } | undefined;
    return `${source?.area}/${source?.key}` === id;
  })!;
  return { state, plan, apply, saved };
}

const analystOf = (folder = files()) => folder.bots.find((bot) => bot.id === "bi/analyst") as ResolvedBot;
const closerOf = (folder = files()) => folder.bots.find((bot) => bot.id === "sales/closer") as ResolvedBot;

describe("an area's tool selection", () => {
  it("lets a bot use only the tools its area allows", () => {
    const folder = files();
    expect(folder.problems).toEqual([]);
    const analyst = analystOf(folder).tools;
    const closer = closerOf(folder).tools;
    expect(allowsTool(analyst, { kind: "mcp", server: "edu", name: "edu_recall" })).toBe(true);
    expect(allowsTool(analyst, { kind: "mcp", server: "data", name: "data_sql" })).toBe(true);
    for (const tool of [
      { kind: "native" as const, name: "Bash" },
      { kind: "mcp" as const, server: "gmail", name: "GMAIL_FETCH_EMAILS" },
      { kind: "mcp" as const, server: "gmail", name: "GMAIL_SEND_EMAIL" },
      { kind: "mcp" as const, server: "computer", name: "screenshot" },
      { kind: "mcp" as const, server: "edu", name: "edu_remember" },
      { kind: "mcp" as const, server: "data", name: "data_load" },
    ]) expect(allowsTool(analyst, tool), JSON.stringify(tool)).toBe(false);
    expect(allowsTool(closer, { kind: "mcp", server: "gmail", name: "GMAIL_FETCH_EMAILS" })).toBe(true);
    expect(allowsTool(closer, { kind: "mcp", server: "data", name: "data_sql" })).toBe(false);
    expect(allowsTool(closer, { kind: "mcp", server: "edu", name: "edu_recall" })).toBe(false);
    expect(allowsTool(closer, { kind: "native", name: "Bash" })).toBe(false);
  });
});

describe("raising an area's permissions", () => {
  const areas = {
    bi: { section: "BI", hashes: {}, maxApproval: "ask" as const },
    sales: { section: "Sales", hashes: {}, maxApproval: "edits" as const },
  };
  type AreaBot = Parameters<typeof botApprovalRefusal>[0];
  const bi = { section: "BI", profileSource: { area: "bi" } } as AreaBot;

  it("refuses an approval above the area ceiling, and a move to a looser area, until the person confirms", () => {
    expect(botApprovalRefusal(bi, undefined, { requestedApproval: "ask" }, areas)).toBeUndefined();
    expect(botApprovalRefusal(bi, undefined, { requestedApproval: "auto" }, areas)).toBe("ask");
    expect(botApprovalRefusal(bi, undefined, { requestedApproval: "full" }, areas)).toBe("ask");
    const sales = { section: "Sales", profileSource: { area: "sales" } } as AreaBot;
    const recorded = bi as unknown as NonNullable<Parameters<typeof botApprovalRefusal>[1]>;
    expect(botApprovalRefusal(sales, recorded, {}, areas)).toBe("ask");
    expect(botApprovalRefusal(sales, recorded, { mayLiftCeiling: true }, areas)).toBeUndefined();
    const req = { headers: {} } as IncomingMessage;
    const shell: RequestAuth = { kind: "loopback", scopes: ["client"], trust: "service" };
    const desktop: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
    const admin: RequestAuth = { kind: "session", via: "bearer", scopes: ["admin", "client"], session: {} as never };
    const member: RequestAuth = { kind: "session", via: "bearer", scopes: ["client"], session: {} as never };
    expect(mayGiveProfileAccess(shell, req, true)).toBe(false);
    expect(mayGiveProfileAccess(desktop, req, false)).toBe(false);
    expect(mayGiveProfileAccess(desktop, req, true)).toBe(true);
    expect(mayGiveProfileAccess(admin, req, false)).toBe(true);
    expect(mayGiveProfileAccess(member, req, true)).toBe(false);
  });

  it("keeps the narrower tools and ceiling until the person confirms the wider profile", async () => {
    const { apply, saved, state } = app();
    const first = await apply(files(), true);
    expect(first.outcome.skipped).toEqual([]);
    expect(saved("bi/analyst")).toMatchObject({ approvalMode: "ask", toolScope: { allow: ["mcp:edu:edu_recall", "mcp:data:data_sql"] } });
    expect(saved("sales/closer")).toMatchObject({ toolScope: { allow: ["mcp:gmail:GMAIL_FETCH_EMAILS"] } });
    expect(state.areas.areas.bi?.maxApproval).toBe("ask");
    const widerTools = `maxApproval: edits
defaults:
  tools: { allow: ["mcp:edu:edu_recall", "mcp:data:data_sql", "native:Bash", "mcp:gmail:GMAIL_SEND_EMAIL"] }
`;
    const wider = files({ "areas/bi/area.md": area("bi", "BI", widerTools, "Numbers come from the BI tools.") });
    expect(wider.problems).toEqual([]);
    const held = await apply(wider, false);
    expect(held.outcome.skipped.length).toBeGreaterThan(0);
    expect(held.outcome.applied.filter((line) => line.kind === "access")).toEqual([]);
    expect(saved("bi/analyst").toolScope).toEqual({ allow: ["mcp:edu:edu_recall", "mcp:data:data_sql"] });
    expect(state.areas.areas.bi?.maxApproval).toBe("ask");
    const confirmed = await apply(wider, true);
    expect(confirmed.outcome.skipped).toEqual([]);
    expect(saved("bi/analyst").toolScope).toEqual({ allow: ["mcp:edu:edu_recall", "mcp:data:data_sql", "native:Bash", "mcp:gmail:GMAIL_SEND_EMAIL"] });
    expect(state.areas.areas.bi?.maxApproval).toBe("edits");
  });
});
