import { createHash } from "node:crypto";

import { APPROVAL_MODES, approvalModeFor, levelWithin, supportsApprovalMode, withinApprovalCeiling, type ApprovalCeiling, type ApprovalMode } from "../../shared/approval-mode.ts";
import type { EduBrainSetting } from "../../shared/edu-brain.ts";
import { problemSentence, type McpServerProfile, type ProfileFolder, type ProfileProblem, type ResolvedBot, type SkillProfile } from "../../shared/profile-format.ts";
import type { ProfileChoice, ProfilePlan, ProfilePlanCounts, ProfilePlanLine, ProfileSecretSlot } from "../../shared/profile-plan.ts";
import { toolScopeWidens, type ToolScope } from "../../shared/tool-scope.ts";
import type { ConnectorToolGrant } from "../../shared/wire.ts";
import { dataGrantWidens } from "../../shared/data-connections.ts";
import { canonicalBrain, canonicalData, canonicalGrants, canonicalScope, changedLines, everyTool, type DesiredBot } from "../desired-bot.ts";
import { eduBrainWidens } from "../edu-brain.ts";
import { SECTION_CONTEXT_MAX_BYTES } from "../section-context.ts";
import { planMcpServers, type McpServerAction } from "./mcp-plan.ts";
import { ENGLISH_PLAN, planSay, sayApproval, sayApprovalPhrase, sayCeiling, sayLines, type PlanSay } from "./plan-words.ts";
import type { ProfilesState } from "./state.ts";

type Rec = Record<string, any>;

/** What the planner reads of this app, as its own routes return it. */
export interface AppView {
  /** GET /api/bots. */
  bots: Rec[];
  sections: string[];
  /** Department briefs by department name, for every department an area maps to. */
  briefs: Record<string, string>;
  /** GET /api/bots/:id/skills for every bot a profile made. */
  skills: Record<string, Array<{ name: string; enabled: boolean; sha256: string }>>;
  /** GET /api/instances: each engine, its kind and the models it offers. */
  instances: Array<{ instanceId: string; driverKind?: string; models: string[] }>;
  /** The MCP servers this app has, by name, as config.json keeps them (a Vault key as its `vault:<id>` pointer). */
  mcpServers: Record<string, unknown>;
  /** The id of the team's Vault secret each secret slot of the folder's MCP servers names, for the names found. */
  vaultSecrets: Record<string, string>;
}

export interface PlanInput {
  /** `contentHash` covers every file read, so the digest changes with any byte of the folder. */
  folder: ProfileFolder & { root: string; contentHash: string };
  commit?: string;
  app: AppView;
  state: ProfilesState;
  choices?: Record<string, ProfileChoice>;
  prune?: boolean;
  /** The language of the person who asked; undefined reads as English. */
  language?: string;
}

export interface SkillOp {
  op: "add" | "replace" | "toggle" | "remove";
  name: string;
  enabled: boolean;
  text?: string;
  description?: string;
  file?: string;
}

/** One field brought to the file's value. `hash` is its new stored hash (null: no longer managed). */
export interface FieldChange {
  field: string;
  line: ProfilePlanLine;
  hash: string | null;
  access: boolean;
  set?: Partial<DesiredBot>;
  section?: string;
  chief?: boolean;
  skill?: SkillOp;
}

export interface AreaAction {
  kind: "area";
  area: string;
  section: string;
  create: boolean;
  renameFrom?: string;
  brief?: { text: string; line: ProfilePlanLine; hash: string };
  nameLine?: ProfilePlanLine;
  /** Hashes kept whatever happens: fields already in sync, kept or settled by a choice. */
  hashes: Record<string, string>;
  nameHash: string;
  maxApproval?: ApprovalCeiling;
  ceilingLine?: ProfilePlanLine;
}

export interface BotAction {
  kind: "bot";
  id: string;
  area: string;
  key: string;
  file: string;
  name: string;
  botId?: string;
  echo: Rec;
  create?: Rec;
  createLine?: ProfilePlanLine;
  hashes: Record<string, string>;
  /** The approval level the file asks for, which may be above the level the plan sets when this app cannot give it. */
  approval?: ApprovalMode;
  /** Fields the file leaves to the app: their values are stored too, so a later file value meets a change made here as
   * a conflict. A new bot's are read from the bot once made. */
  unmanaged: string[];
  changes: FieldChange[];
}

export interface RemoveAction {
  kind: "remove";
  botId: string;
  line: ProfilePlanLine;
}

export type ProfileAction = AreaAction | BotAction | RemoveAction | McpServerAction;

export interface PlanOutput {
  plan: ProfilePlan;
  actions: ProfileAction[];
  /** Areas of the stored state the plan no longer maps, which applying forgets. */
  goneAreas: string[];
  /** The MCP servers profiles.json keeps whatever applying does; each server written replaces its entry. */
  mcpServers: ProfilesState["mcpServers"];
}

/** The levels POST /api/bots takes; a bot on any other level starts at Ask and is raised to it afterwards. */
const CREATE_APPROVALS = new Set<string>(["ask", "auto", "full"]);
const fold = (name: string | undefined) => (name ?? "").trim().toLowerCase();
const sorted = (list: readonly string[] | undefined) => [...new Set(list ?? [])].sort();

/** The short hash a field's value is stored under. */
export function valueHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value) ?? "null").digest("hex").slice(0, 16);
}

/** The stored hash of a bot's approval: the file's level, or, when this app refused that level and the bot was left at a
 * lower one, the pair, so the next plan explains the lower level instead of offering the refused one again. */
export function approvalHash(file: ApprovalMode, at: ApprovalMode): string {
  return file === at ? valueHash(file) : valueHash({ approval: file, at });
}

function refusedApproval(hash: string | undefined): { file: ApprovalMode; at: ApprovalMode } | undefined {
  if (hash === undefined) return undefined;
  for (const file of APPROVAL_MODES) for (const at of APPROVAL_MODES) if (file !== at && approvalHash(file, at) === hash) return { file, at };
  return undefined;
}

/** The hash `decide` compares a stored hash as: a refused approval counts as the level the bot was left at. */
function storedValueHash(field: string, hash: string | undefined): string | undefined {
  const refused = field === "approval" ? refusedApproval(hash) : undefined;
  return refused ? valueHash(refused.at) : hash;
}

/** The highest level at or below `wanted` that an engine of `driverKind` runs; `wanted` when the engine is not known. */
export function approvalFloor(wanted: ApprovalMode, driverKind: string | undefined): ApprovalMode {
  if (driverKind === undefined) return wanted;
  return [...APPROVAL_MODES].reverse().find((mode) => levelWithin(mode, wanted) && supportsApprovalMode(driverKind, mode)) ?? "ask";
}


const short = (text: string, max = 60) => {
  const line = text.split("\n")[0]!.trim();
  return line.length > max || text.includes("\n") ? `${line.slice(0, max).trimEnd()}…` : line;
};

/** "same": nothing to do; "take": apply the file; "here": changed in this app, kept; "conflict": both changed. */
export function decide(base: string | undefined, file: string, app: string): "same" | "take" | "here" | "conflict" {
  if (file === app) return "same";
  if (base === undefined || app === base) return "take";
  if (file === base) return "here";
  return "conflict";
}

interface FieldSpec {
  field: string;
  label: Parameters<PlanSay>[0];
  /** The file's value; undefined leaves the field to the app. */
  file(bot: ResolvedBot): unknown;
  app(echo: Rec): unknown;
  /** Comparable form; the hash is taken of it. */
  canon?(value: unknown): unknown;
  show(value: unknown, say: PlanSay): string;
  widens?(app: unknown, file: unknown, echo: Rec): boolean;
  set(value: unknown): Partial<DesiredBot>;
}

const connectorsWiden = (app: unknown, file: unknown, echo: Rec): boolean => {
  const want = file as Record<string, ConnectorToolGrant>;
  if (echo.composio === false) return Object.keys(want).length > 0;
  if (app === null) return false;
  const have = app as Record<string, ConnectorToolGrant>;
  return Object.entries(want).some(([slug, grant]) => {
    const held = have[slug];
    if (!held) return true;
    if (held.tools === "*") return false;
    return grant.tools === "*" || grant.tools.some((tool) => !(held.tools as string[]).includes(tool));
  });
};

const brainMode = (setting: EduBrainSetting, say: PlanSay) => setting.mode === "folder" ? say("server.profiles.brain.folder", { path: setting.path })
  : setting.mode === "area" ? say(setting.personalBrain === false ? "server.profiles.brain.areaNoPersonal" : "server.profiles.brain.area", { area: setting.area })
    : setting.mode === "cloud" ? "secret" in setting.token ? say("server.profiles.brain.cloudSecret", { url: setting.url, name: setting.token.secret })
      : say("server.profiles.brain.cloudEnv", { url: setting.url, name: setting.token.env })
      : say(setting.mode === "own" ? "server.profiles.brain.own" : "server.profiles.brain.off");

/** The bot setting a profile's Edu brain gives: an area brain is its own area's; a cloud token kept in a key file is not
 * one this app reads, so that brain is left to the app. */
export function profileEduBrain(bot: Pick<ResolvedBot, "eduBrain" | "area" | "personalBrain">): EduBrainSetting | undefined {
  const brain = bot.eduBrain;
  if (!brain) return undefined;
  if (brain.mode === "area") return { mode: "area", area: bot.area, ...(bot.personalBrain === false ? { personalBrain: false as const } : {}) };
  if (brain.mode === "cloud") return "file" in brain.token ? undefined : { mode: "cloud", url: brain.url, token: brain.token };
  return { mode: brain.mode };
}

const FIELDS: FieldSpec[] = [
  { field: "name", label: "server.profiles.label.name", file: (bot) => bot.name, app: (echo) => echo.name ?? "", show: (v) => `"${v}"`, set: (v) => ({ name: v as string }) },
  { field: "title", label: "server.profiles.label.title", file: (bot) => bot.title, app: (echo) => echo.title ?? "", show: (v) => `"${short(v as string)}"`, set: (v) => ({ title: v as string }) },
  { field: "description", label: "server.profiles.label.description", file: (bot) => bot.description, app: (echo) => echo.description ?? "", show: (v) => `"${short(v as string)}"`,
    set: (v) => ({ description: v as string }) },
  { field: "soul", label: "server.profiles.label.instructions", file: (bot) => bot.soul.trimEnd(), app: (echo) => String(echo.soul ?? "").trimEnd(),
    show: (v, say) => (v as string) ? `"${short(v as string)}"` : say("server.profiles.value.empty"), set: (v) => ({ soul: v as string }) },
  { field: "model", label: "server.profiles.label.model", file: (bot) => bot.model, app: (echo) => echo.modelSelection ? `${echo.modelSelection.instanceId}/${echo.modelSelection.model}` : "",
    show: (v, say) => String(v || say("server.profiles.value.none")), set: (v) => {
      const [instanceId, ...model] = String(v).split("/");
      return { model: { instanceId: instanceId!, model: model.join("/") } };
    } },
  { field: "effort", label: "server.profiles.label.effort", file: (bot) => bot.effort, app: (echo) => echo.modelSelection?.effort ?? "", show: (v, say) => String(v || say("server.profiles.value.modelDefault")),
    set: (v) => ({ effort: v as string }) },
  { field: "approval", label: "server.profiles.label.approval", file: (bot) => bot.approval, app: (echo) => approvalModeFor(echo), show: (v, say) => sayApproval(say, String(v)),
    widens: (app, file) => !levelWithin(file as ApprovalMode, app as ApprovalMode), set: (v) => ({ approval: v as DesiredBot["approval"] }) },
  { field: "tools", label: "server.profiles.label.tools", file: (bot) => bot.tools, app: (echo) => echo.toolScope ?? null, canon: (v) => canonicalScope(v as Rec | null),
    show: (v, say) => say(everyTool(v as Rec | null) ? "server.profiles.value.everyTool" : "server.profiles.value.someTools"), widens: (app, file) => toolScopeWidens(app ?? undefined, file),
    set: (v) => ({ tools: everyTool(v as ToolScope) ? null : v as ToolScope }) },
  { field: "toolsOff", label: "server.profiles.label.toolsOff", file: (bot) => bot.toolsOff && sorted(bot.toolsOff), app: (echo) => sorted(echo.toolsOff),
    show: (v, say) => (v as string[]).length ? (v as string[]).join(", ") : say("server.profiles.value.none"), widens: (app, file) => (app as string[]).some((group) => !(file as string[]).includes(group)),
    set: (v) => ({ toolsOff: v as DesiredBot["toolsOff"] }) },
  { field: "mcpServers", label: "server.profiles.label.mcpServers", file: (bot) => bot.mcpServers.length ? sorted(bot.mcpServers) : undefined,
    app: (echo) => Array.isArray(echo.mcpServers) ? sorted(echo.mcpServers) : null, canon: (v) => v ?? "every server",
    show: (v, say) => v === null ? say("server.profiles.value.everyServer") : (v as string[]).length ? (v as string[]).join(", ") : say("server.profiles.value.none"),
    widens: (app, file) => app !== null && (file as string[]).some((name) => !(app as string[]).includes(name)), set: (v) => ({ mcpServers: v as string[] }) },
  { field: "data", label: "server.profiles.label.data", file: (bot) => bot.data, app: (echo) => echo.dataConnections ?? {},
    canon: (v) => canonicalData(v as DesiredBot["data"]), show: (v, say) => Object.keys((v ?? {}) as Rec).sort().join(", ") || say("server.profiles.value.none"),
    widens: (app, file) => dataGrantWidens(app as DesiredBot["data"], file as DesiredBot["data"]), set: (v) => ({ data: (v ?? {}) as DesiredBot["data"] }) },
  { field: "connectors", label: "server.profiles.label.connectors", file: (bot) => bot.connectors, app: (echo) => echo.connectorTools ?? null,
    canon: (v) => canonicalGrants(v as Record<string, ConnectorToolGrant> | null),
    show: (v, say) => v === null ? say("server.profiles.value.everyApp") : Object.keys(v as Rec).sort().join(", ") || say("server.profiles.value.none"), widens: connectorsWiden,
    set: (v) => ({ connectorTools: v as Record<string, ConnectorToolGrant> }) },
  { field: "eduBrain", label: "server.profiles.label.eduBrain", file: profileEduBrain,
    app: (echo) => echo.eduBrain ?? { mode: "own" }, canon: (v) => canonicalBrain(v as EduBrainSetting), show: (v, say) => brainMode(v as EduBrainSetting, say),
    widens: (app, file) => eduBrainWidens(app as EduBrainSetting, file as EduBrainSetting), set: (v) => ({ eduBrain: v as EduBrainSetting }) },
  { field: "eduCrew", label: "server.profiles.label.eduCrew", file: (bot) => bot.eduCrew, app: (echo) => echo.eduCrew === true, show: (v, say) => say(v ? "server.profiles.value.on" : "server.profiles.value.off"),
    widens: (app, file) => file === true && app !== true, set: (v) => ({ eduCrew: v as boolean }) },
  { field: "memory.enabled", label: "server.profiles.label.memory", file: (bot) => bot.memory?.enabled, app: (echo) => echo.memoryEnabled !== false, show: (v, say) => say(v ? "server.profiles.value.on" : "server.profiles.value.off"),
    set: (v) => ({ memoryEnabled: v as boolean }) },
  { field: "memory.upkeep", label: "server.profiles.label.memoryUpkeep", file: (bot) => bot.memory?.upkeep, app: (echo) => echo.memoryUpkeep !== false, show: (v, say) => say(v ? "server.profiles.value.on" : "server.profiles.value.off"),
    set: (v) => ({ memoryUpkeep: v as boolean }) },
];

const CHIEF: Pick<FieldSpec, "field" | "file" | "app"> = { field: "chief", file: (bot) => bot.chief, app: (echo) => echo.chiefOfStaff === true };

const canonOf = (spec: Pick<FieldSpec, "canon">, value: unknown) => (spec.canon ? spec.canon(value) : value);

/** The stored hashes of `fields` as `echo` has them. */
export function appHashes(fields: readonly string[], echo: Rec): Record<string, string> {
  return Object.fromEntries(FIELDS.filter((spec) => fields.includes(spec.field)).map((spec) => [spec.field, valueHash(canonOf(spec, spec.app(echo)))]));
}

/** The fields of a stamped bot whose value in this app no longer matches the hash the profile last stored: changed here.
 * With `bot`, only the fields its file sets count; a field left to the app is the app's to change. */
export function changedHereFields(hashes: Readonly<Record<string, string>>, echo: Rec, bot?: ResolvedBot): string[] {
  const specs: Array<Pick<FieldSpec, "field" | "file" | "app" | "canon">> = [...FIELDS, CHIEF];
  return specs.filter((spec) => hashes[spec.field] !== undefined && (!bot || spec.file(bot) !== undefined)
    && storedValueHash(spec.field, hashes[spec.field]) !== valueHash(canonOf(spec, spec.app(echo)))).map((spec) => spec.field);
}

/** The secret slots a bot's profile names: its Edu brain's token and the headers and variables of its MCP servers.
 * Security: a file slot never carries its path. */
export function botSecretSlots(bot: ResolvedBot, servers: readonly McpServerProfile[]): ProfileSecretSlot[] {
  const slots = new Map<string, ProfileSecretSlot>();
  const add = (ref: unknown, used: string) => {
    if (!ref || typeof ref !== "object") return;
    const slot: ProfileSecretSlot | null = "secret" in ref && typeof ref.secret === "string" ? { kind: "secret", name: ref.secret, for: used }
      : "env" in ref && typeof ref.env === "string" ? { kind: "env", name: ref.env, for: used }
        : "file" in ref && typeof ref.file === "string" ? { kind: "file", for: used } : null;
    const key = slot && (slot.kind === "file" ? `file:${used}` : `${slot.kind}:${slot.name}`);
    if (slot && key && !slots.has(key)) slots.set(key, slot);
  };
  if (bot.eduBrain?.mode === "cloud") add(bot.eduBrain.token, "Edu brain");
  for (const name of bot.mcpServers) {
    const server = servers.find((candidate) => candidate.key === name);
    for (const value of [...Object.values(server?.headers ?? {}), ...Object.values(server?.env ?? {})]) add(value, name);
  }
  return [...slots.values()];
}

/** Which areas and bots a folder's problems leave alone. A problem at a bot's file blocks that bot; anywhere else under
 * `areas/<a>/` it blocks the whole area; in an MCP file it blocks nothing; anywhere else (a skill, org.md, the folder) it
 * blocks everything. Security: what is blocked is never called gone, so a broken or linked path never deletes a bot. */
function blockedBy(problems: readonly ProfileProblem[]) {
  let everything: string | undefined;
  const areas = new Map<string, string>();
  const bots = new Map<string, string>();
  for (const { file } of problems) {
    const path = file.toLowerCase();
    const bot = /^areas\/([^/]+)\/bots\/([^/]+)\.md$/.exec(path);
    const area = /^areas\/([^/]+)(?:\/|$)/.exec(path);
    if (path === "mcp" || path.startsWith("mcp/")) continue;
    if (bot) bots.set(`${bot[1]}/${bot[2]}`, bots.get(`${bot[1]}/${bot[2]}`) ?? file);
    else if (area && !/^areas\/[^/]+\/skills(?:\/|$)/.test(path)) areas.set(area[1]!, areas.get(area[1]!) ?? file);
    else everything ??= file;
  }
  const all = everything !== undefined;
  const areaOf = (id: string) => id.split("/")[0]!.toLowerCase();
  return {
    all,
    /** The file that blocks everything. */
    everything,
    area: (area: string) => all || areas.has(area.toLowerCase()),
    /** A problem anywhere under the area's folder: the folder is there, so the area is not gone. */
    under: (area: string) => all || areas.has(area.toLowerCase()) || [...bots.keys()].some((id) => areaOf(id) === area.toLowerCase()),
    bot: (id: string) => all || areas.has(areaOf(id)) || bots.has(id.toLowerCase()),
    file: (id: string) => bots.get(id.toLowerCase()) ?? areas.get(areaOf(id)),
  };
}

const sentence = (problem: ProfileProblem) => ({ ...problem, sentence: problemSentence(problem) });

/** Compares a profile folder with this app and says, line by line, what applying it would do. Nothing here writes. */
export function planProfiles(input: PlanInput): PlanOutput {
  const { folder, app, state } = input;
  const say = input.language === undefined ? ENGLISH_PLAN : planSay(input.language);
  const choices = input.choices ?? {};
  const lines: ProfilePlanLine[] = [];
  const actions: ProfileAction[] = [];
  const blocked = blockedBy(folder.problems);
  let settled = 0;
  const kept = (line: Omit<ProfilePlanLine, "kind" | "text">, what: string) => {
    settled += 1;
    lines.push({ ...line, kind: "note", text: say("server.profiles.labelled", { what, text: say("server.profiles.kept") }) });
  };
  const sectionNamed = (name: string) => app.sections.find((section) => fold(section) === fold(name));

  if (blocked.all) {
    const file = folder.problems.some((problem) => problem.file === "org.md") ? "org.md" : blocked.everything!;
    lines.push({ kind: "blocked", subject: { kind: "organization", id: ".", name: folder.org?.name ?? say("server.profiles.organization") }, file,
      text: say("server.profiles.blockedAll", { file: file === "." || file === "areas" ? say("server.profiles.theFolder") : file }) });
  }

  const areaSection = new Map<string, string>();
  const renamedFrom = new Map<string, string>();
  const areaNames = new Map(folder.areas.map((area) => [area.key, area.name]));
  const orgBrief = folder.org?.brief.trim() ?? "";
  for (const area of folder.areas) {
    const subject = { kind: "area" as const, id: area.key, name: area.name };
    const stored = state.areas[area.key];
    const existing = (stored && sectionNamed(stored.section)) ?? sectionNamed(area.name);
    if (blocked.area(area.key)) {
      if (existing) areaSection.set(area.key, existing);
      const file = blocked.file(area.key) ?? area.file;
      if (!blocked.all) lines.push({ kind: "blocked", subject, file, text: say("server.profiles.blockedArea", { file, area: area.name }) });
      continue;
    }
    const base = stored?.hashes ?? {};
    const hashes: Record<string, string> = { ...base };
    const nameHash = valueHash(area.name);
    const maxApproval = area.maxApproval || folder.org?.maxApproval
      ? withinApprovalCeiling(area.maxApproval ?? "full", folder.org?.maxApproval) as ApprovalCeiling
      : undefined;
    const action: AreaAction = { kind: "area", area: area.key, section: existing ?? area.name, create: !existing, hashes, nameHash,
      ...(maxApproval ? { maxApproval } : {}),
    };
    if (!existing) {
      action.nameLine = { kind: "add", subject, file: area.file, text: say("server.profiles.addsArea", { area: area.name }) };
    } else {
      const choice = `area:${area.key}:name`;
      const outcome = settle(decide(base.name, nameHash, valueHash(existing)), choices[choice]);
      if (outcome === "mine") kept({ subject, field: "name", file: area.file }, say("server.profiles.area.name", { area: area.name }));
      if (outcome === "same" || outcome === "mine") hashes.name = nameHash;
      else if (outcome === "here") {
        lines.push({ kind: "changed-here", subject, field: "name", file: area.file, text: say("server.profiles.area.renamedHere", { area: area.name, name: existing }) });
      } else if (outcome === "conflict") {
        lines.push({ kind: "conflict", subject, field: "name", file: area.file, text: say("server.profiles.area.nameConflict", { area: area.name, name: existing }),
          conflict: { choice, file: area.name, mine: existing } });
      } else if (sectionNamed(area.name) && fold(sectionNamed(area.name)) !== fold(existing)) {
        hashes.name = base.name ?? valueHash(existing);
        lines.push({ kind: "note", subject, field: "name", file: area.file, text: say("server.profiles.area.nameTaken", { area: area.name, name: existing }) });
      } else {
        action.section = area.name;
        action.renameFrom = existing;
        renamedFrom.set(area.key, existing);
        action.nameLine = { kind: "change", subject, field: "name", file: area.file, text: say("server.profiles.area.renamed", { area: area.name, name: existing }) };
      }
    }
    areaSection.set(area.key, action.section);
    const brief = [orgBrief, area.brief.trim()].filter(Boolean).join("\n\n");
    if (Buffer.byteLength(brief, "utf8") > SECTION_CONTEXT_MAX_BYTES) {
      lines.push({ kind: "note", subject, field: "brief", file: area.file,
        text: say("server.profiles.area.briefTooLong", { area: area.name, bytes: SECTION_CONTEXT_MAX_BYTES }) });
    } else {
      const current = existing ? (app.briefs[existing] ?? "").trimEnd() : "";
      const choice = `area:${area.key}:brief`;
      const fileHash = valueHash(brief);
      const outcome = settle(decide(base.brief, fileHash, valueHash(current)), choices[choice]);
      if (outcome === "mine") kept({ subject, field: "brief", file: area.file }, say("server.profiles.area.brief", { area: area.name }));
      if (outcome === "same" || outcome === "mine") hashes.brief = fileHash;
      else if (outcome === "here") {
        lines.push({ kind: "changed-here", subject, field: "brief", file: area.file, text: say("server.profiles.area.briefHere", { area: area.name }) });
      } else if (outcome === "conflict") {
        lines.push({ kind: "conflict", subject, field: "brief", file: area.file, text: say("server.profiles.area.briefConflict", { area: area.name }),
          conflict: { choice, file: short(brief), mine: short(current) } });
      } else {
        action.brief = { text: brief, hash: fileHash, line: { kind: existing ? "change" : "add", subject, field: "brief", file: area.file,
          text: current ? say("server.profiles.area.briefChanged", { area: area.name, lines: sayLines(say, changedLines(current, brief)) }) : say("server.profiles.area.briefSet", { area: area.name }) } };
      }
    }
    if ((existing || stored) && stored?.maxApproval !== maxApproval) {
      const givesAccess = Boolean(stored?.maxApproval && (!maxApproval || !levelWithin(maxApproval, stored.maxApproval)));
      action.ceilingLine = { kind: givesAccess ? "access" : "change", subject, field: "maxApproval", file: area.file,
        text: maxApproval ? say("server.profiles.area.ceiling", { area: area.name, level: sayCeiling(say, maxApproval) }) : say("server.profiles.area.noCeiling", { area: area.name }) };
      lines.push(action.ceilingLine);
    }
    if (action.nameLine) lines.push(action.nameLine);
    if (action.brief) lines.push(action.brief.line);
    actions.push(action);
  }
  const goneAreas = Object.keys(state.areas).filter((key) => !areaNames.has(key) && !blocked.under(key));
  for (const key of goneAreas) {
    const { section, maxApproval } = state.areas[key]!;
    const subject = { kind: "area" as const, id: key, name: section };
    if (maxApproval) lines.push({ kind: "access", subject, field: "maxApproval", text: say("server.profiles.area.noCeiling", { area: section }) });
    lines.push({ kind: "gone", subject, text: say("server.profiles.area.gone", { area: section }) });
  }
  const areaOfSection = (section: string | undefined) => {
    for (const [key, name] of areaSection) if (fold(name) === fold(section) || fold(renamedFrom.get(key)) === fold(section)) return key;
    return section ? `section:${section}` : "";
  };

  const skillByFile = new Map<string, SkillProfile>(folder.skills.map((skill) => [skill.file, skill]));
  const stamped = app.bots.filter((bot) => bot.profileSource && typeof bot.profileSource.area === "string" && typeof bot.profileSource.key === "string");
  const claimed = new Set<string>();
  for (const bot of folder.bots) {
    if (blocked.bot(bot.id)) continue;
    const matches = stamped.filter((candidate) => `${candidate.profileSource.area}/${candidate.profileSource.key}` === bot.id && !claimed.has(candidate.id))
      .sort((a, b) => Number(Boolean(a.hidden)) - Number(Boolean(b.hidden)));
    const echo = matches[0];
    const subject = { kind: "bot" as const, id: bot.id, name: bot.name, ...(echo ? { botId: echo.id as string } : {}) };
    if (matches.length > 1) {
      lines.push({ kind: "note", subject, file: bot.file, text: say("server.profiles.bot.duplicates", { bot: bot.name, count: matches.length, file: bot.file, name: echo!.name }) });
    }
    if (echo) claimed.add(echo.id);
    const section = areaSection.get(bot.area) ?? areaNames.get(bot.area) ?? bot.area;
    const action: BotAction = { kind: "bot", id: bot.id, area: bot.area, key: bot.key, file: bot.file, name: bot.name, echo: echo ?? { name: bot.name }, hashes: {}, unmanaged: [], changes: [],
      ...(echo ? { botId: echo.id } : {}) };
    const base: Record<string, string> = echo?.profileSource?.hashes ?? {};
    const note = (text: string, field?: string) => lines.push({ kind: "note", subject, file: bot.file, text, ...(field ? { field } : {}) });
    if (bot.eduBrain?.mode === "cloud" && "file" in bot.eduBrain.token) {
      note(say(echo ? "server.profiles.bot.brainKeyFileKept" : "server.profiles.bot.brainKeyFileOwn", { bot: bot.name }), "eduBrain");
    }
    for (const name of bot.mcpServers.filter((server) => !Object.hasOwn(app.mcpServers, server) && !folder.mcpServers.some((defined) => defined.key === server))) {
      note(say("server.profiles.bot.noMcpServer", { bot: bot.name, name }), "mcpServers");
    }
    let modelSkipped = false;
    if (bot.model) {
      const [instanceId, ...rest] = bot.model.split("/");
      const instance = app.instances.find((candidate) => candidate.instanceId === instanceId);
      const model = rest.join("/");
      if (!instance) {
        modelSkipped = true;
        note(say("server.profiles.bot.noEngine", { bot: bot.name, engine: instanceId!, model: say(echo ? "server.profiles.bot.currentModel" : "server.profiles.bot.defaultModel") }), "model");
      } else if (!instance.models.includes(model)) {
        modelSkipped = true;
        note(say("server.profiles.bot.noModel", { bot: bot.name, engine: instanceId!, name: model, model: say(echo ? "server.profiles.bot.currentModel" : "server.profiles.bot.defaultModel") }), "model");
      }
    }
    const fieldLine = (kind: ProfilePlanLine["kind"], field: string, text: string, extra: Partial<ProfilePlanLine> = {}): ProfilePlanLine =>
      ({ kind, subject, field, file: bot.file, text: say("server.profiles.labelled", { what: bot.name, text }), ...extra });

    const consider = (field: string, label: string, fileValue: unknown, fileCanon: unknown, appValue: unknown, appCanon: unknown, show: (value: unknown) => string,
      widens: boolean, apply: Omit<FieldChange, "field" | "line" | "hash" | "access">,
      changedHere: (value: unknown) => string = (value) => say("server.profiles.field.changedHere", { label, value: show(value) }), storedHash?: string) => {
      const fileHash = storedHash ?? valueHash(fileCanon);
      const choice = `${bot.id}:${field}`;
      const outcome = echo ? settle(decide(storedValueHash(field, base[field]), valueHash(fileCanon), valueHash(appCanon)), choices[choice]) : "take";
      if (outcome === "mine") kept({ subject, field, file: bot.file }, say("server.profiles.labelled", { what: bot.name, text: label }));
      if (outcome === "same" || outcome === "mine") { action.hashes[field] = fileHash; return outcome; }
      if (outcome === "here") {
        action.hashes[field] = base[field]!;
        lines.push(fieldLine("changed-here", field, say("server.profiles.then", { text: changedHere(appValue), more: say("server.profiles.changeStays") })));
        return outcome;
      }
      if (outcome === "conflict") {
        action.hashes[field] = base[field]!;
        lines.push(fieldLine("conflict", field, say("server.profiles.field.conflict", { label, file: show(fileValue), mine: show(appValue) }),
          { conflict: { choice, file: show(fileValue), mine: show(appValue) } }));
        return outcome;
      }
      if (base[field] !== undefined) action.hashes[field] = base[field]!;
      const text = field === "soul" && appValue ? say("server.profiles.field.instructionsChanged", { lines: sayLines(say, changedLines(appValue as string, fileValue as string)) })
        : echo ? say("server.profiles.field.change", { label, from: show(appValue), to: show(fileValue) }) : say("server.profiles.field.set", { label, value: show(fileValue) });
      const line = fieldLine(widens ? "access" : echo ? "change" : "add", field, text);
      action.changes.push({ field, line, hash: fileHash, access: widens, ...apply });
      return outcome;
    };

    let approvalShown: ApprovalMode | undefined;
    const considerApproval = (spec: FieldSpec, wanted: ApprovalMode, appValue: ApprovalMode) => {
      action.approval = wanted;
      const engine = bot.model && !modelSkipped ? bot.model.split("/")[0] : echo?.modelSelection?.instanceId;
      const floor = approvalFloor(wanted, app.instances.find((instance) => instance.instanceId === engine)?.driverKind);
      const refused = echo ? refusedApproval(base.approval) : undefined;
      const held = refused && refused.file === wanted && refused.at !== floor && levelWithin(refused.at, floor) ? refused.at : undefined;
      const target = held ?? floor;
      approvalShown = target;
      const outcome = !echo && target === appValue ? (action.hashes.approval = valueHash(target), "same" as const)
        : consider(spec.field, say(spec.label), target, target, appValue, appValue, (value) => spec.show(value, say), spec.widens!(appValue, target, action.echo), { set: spec.set(target) },
          undefined, held ? base.approval : undefined);
      if (target === wanted || outcome === "here" || outcome === "conflict" || outcome === "mine") return;
      const how = !echo ? "server.profiles.bot.approvalStartsAt" : outcome === "take" ? "server.profiles.bot.approvalGoesTo" : "server.profiles.bot.approvalStaysAt";
      const words = { bot: bot.name, wanted: sayApproval(say, wanted), level: sayApprovalPhrase(say, target) };
      note(say(held ? "server.profiles.bot.approvalRefused" : how, words), "approval");
    };

    for (const spec of FIELDS) {
      if (modelSkipped && (spec.field === "model" || spec.field === "effort")) {
        if (base[spec.field] !== undefined) action.hashes[spec.field] = base[spec.field]!;
        continue;
      }
      const fileValue = spec.file(bot);
      const appValue = spec.app(action.echo);
      if (fileValue === undefined) {
        if (echo) action.hashes[spec.field] = base[spec.field] ?? valueHash(canonOf(spec, appValue));
        else action.unmanaged.push(spec.field);
        continue;
      }
      if (!echo && spec.field === "name") continue;
      if (spec.field === "approval") { considerApproval(spec, fileValue as ApprovalMode, appValue as ApprovalMode); continue; }
      const fileCanon = canonOf(spec, fileValue);
      const appCanon = canonOf(spec, appValue);
      if (!echo && JSON.stringify(fileCanon) === JSON.stringify(appCanon)) { action.hashes[spec.field] = valueHash(fileCanon); continue; }
      consider(spec.field, say(spec.label), fileValue, fileCanon, appValue, appCanon, (value) => spec.show(value, say), spec.widens?.(appValue, fileValue, action.echo) === true, { set: spec.set(fileValue) });
    }
    const appArea = echo ? areaOfSection(echo.section) : "";
    const areaShow = (value: unknown) => {
      const key = String(value);
      return key.startsWith("section:") ? key.slice("section:".length) : key ? areaSection.get(key) ?? areaNames.get(key) ?? key : say("server.profiles.value.noDepartment");
    };
    if (echo) consider("area", say("server.profiles.label.area"), bot.area, bot.area, appArea, appArea, areaShow, false, { section });
    else action.hashes.area = valueHash(bot.area);
    if (echo || bot.chief) {
      const chief = echo ? CHIEF.app(echo) : false;
      consider(CHIEF.field, say("server.profiles.label.chief"), bot.chief, bot.chief, chief, chief, (v) => say(v ? "server.profiles.value.yes" : "server.profiles.value.no"), false, { chief: bot.chief },
        (v) => say(v ? "server.profiles.value.madeChief" : "server.profiles.value.unmadeChief"));
    }

    const installed = new Map((echo ? app.skills[echo.id] ?? [] : []).map((skill) => [skill.name, skill]));
    const names = new Set([...bot.skills.map((skill) => skill.name), ...Object.keys(base).filter((field) => field.startsWith("skills.")).map((field) => field.slice(7))]);
    for (const name of [...names].sort()) {
      const field = `skills.${name}`;
      const wanted = bot.skills.find((skill) => skill.name === name);
      const source = wanted ? skillByFile.get(wanted.file) : undefined;
      if (wanted && !source) continue;
      const has = installed.get(name);
      const fileValue = wanted ? { sha256: sha256(source!.text), enabled: wanted.enabled } : null;
      const appValue = has ? { sha256: has.sha256, enabled: has.enabled } : null;
      if (!fileValue && !appValue) continue;
      const show = (value: unknown) => say(value === null ? "server.profiles.value.notInstalled" : (value as Rec).enabled ? "server.profiles.value.on" : "server.profiles.value.off");
      const op: SkillOp = !fileValue ? { op: "remove", name, enabled: false }
        : !appValue ? { op: "add", name, enabled: fileValue.enabled, text: source!.text, description: source!.description, file: source!.file }
          : appValue.sha256 !== fileValue.sha256 ? { op: "replace", name, enabled: fileValue.enabled, text: source!.text, description: source!.description, file: source!.file }
            : { op: "toggle", name, enabled: fileValue.enabled };
      const label = say("server.profiles.label.skill", { name });
      const fileHash = valueHash(fileValue);
      const choice = `${bot.id}:${field}`;
      const outcome = echo ? settle(decide(base[field], fileHash, valueHash(appValue)), choices[choice]) : "take";
      if (outcome === "mine") kept({ subject, field, file: bot.file }, say("server.profiles.labelled", { what: bot.name, text: label }));
      if (outcome === "same" || outcome === "mine") { if (fileValue) action.hashes[field] = fileHash; continue; }
      if (outcome === "here") {
        if (fileValue) action.hashes[field] = base[field]!;
        lines.push(fieldLine("changed-here", field, say("server.profiles.then", { text: say("server.profiles.field.changedHereOnly", { label }), more: say("server.profiles.changeStays") })));
        continue;
      }
      if (outcome === "conflict") {
        action.hashes[field] = base[field]!;
        lines.push(fieldLine("conflict", field, say("server.profiles.field.bothChanged", { label }), { conflict: { choice, file: show(fileValue), mine: show(appValue) } }));
        continue;
      }
      if (base[field] !== undefined) action.hashes[field] = base[field]!;
      const text = op.op === "add" ? say(fileValue!.enabled ? "server.profiles.skill.added" : "server.profiles.skill.addedOff", { label }) : op.op === "replace" ? say("server.profiles.skill.updated", { label, file: op.file! })
        : op.op === "remove" ? say("server.profiles.skill.removed", { label }) : say(op.enabled ? "server.profiles.skill.on" : "server.profiles.skill.off", { label });
      action.changes.push({ field, line: fieldLine(echo ? "change" : "add", field, text), hash: fileValue ? fileHash : null, access: false, skill: op });
    }

    if (!echo) {
      const details = [bot.title, bot.chief ? say("server.profiles.bot.chiefOf", { area: section }) : "", bot.model && !modelSkipped ? bot.model : "", approvalShown ? sayApproval(say, approvalShown) : ""].filter(Boolean).join(" · ");
      action.createLine = { kind: "add", subject, file: bot.file, text: say(details ? "server.profiles.bot.addsDescribed" : "server.profiles.bot.adds", { bot: bot.name, area: section, details }) };
      const approvalChange = action.changes.find((change) => change.field === "approval");
      const createdAt = approvalChange && !approvalChange.access && CREATE_APPROVALS.has(approvalChange.set!.approval!) ? approvalChange.set!.approval! : approvalChange ? "ask" : undefined;
      if (approvalChange && createdAt === approvalChange.set!.approval) {
        action.changes.splice(action.changes.indexOf(approvalChange), 1);
        action.hashes.approval = approvalChange.hash!;
      }
      action.create = {
        useDefaults: false, name: bot.name, section,
        ...(bot.title !== undefined ? { title: bot.title } : {}), ...(bot.description !== undefined ? { description: bot.description } : {}),
        ...(bot.model && !modelSkipped ? { modelSelection: modelSelection(bot.model, bot.effort), requireAvailableModel: true } : {}),
        ...(createdAt ? { settings: { approvalMode: createdAt } } : {}),
      };
      lines.push(action.createLine);
      lines.push(...action.changes.filter((change) => change.access).map((change) => change.line));
    } else {
      lines.push(...action.changes.map((change) => change.line));
    }
    actions.push(action);
  }

  for (const echo of stamped.filter((bot) => !claimed.has(bot.id))) {
    const id = `${echo.profileSource.area}/${echo.profileSource.key}`;
    const subject = { kind: "bot" as const, id, name: echo.name, botId: echo.id };
    if (blocked.bot(id)) {
      const file = blocked.file(id) ?? echo.profileSource.file;
      if (!blocked.all) lines.push({ kind: "blocked", subject, file, text: say("server.profiles.blockedOne", { file, name: echo.name }) });
      continue;
    }
    if (folder.bots.some((bot) => bot.id === id)) continue;
    if (input.prune) {
      const line: ProfilePlanLine = { kind: "remove", subject, file: echo.profileSource.file, text: say("server.profiles.bot.deletes", { name: echo.name }) };
      lines.push(line);
      actions.push({ kind: "remove", botId: echo.id, line });
    } else {
      lines.push({ kind: "gone", subject, file: echo.profileSource.file, text: say("server.profiles.bot.gone", { name: echo.name }) });
    }
  }

  const mcp = planMcpServers({ servers: folder.mcpServers, problems: folder.problems, blockedAll: blocked.all, app: app.mcpServers, vault: app.vaultSecrets,
    state: state.mcpServers, choices, prune: input.prune === true, say });
  lines.push(...mcp.lines);
  actions.push(...mcp.actions);
  settled += mcp.settled;

  if (blocked.all) {
    for (const line of lines) if (line.kind === "add" || line.kind === "change" || line.kind === "access" || line.kind === "remove") line.kind = "blocked";
    actions.length = 0;
  }
  const counts = countLines(lines);
  const noChanges = counts.add + counts.change + counts.access + counts.conflict + counts.remove + settled === 0;
  const keptAreas = blocked.all ? [] : goneAreas;
  const digest = planDigest({ folder, commit: input.commit, lines, actions, goneAreas: keptAreas, mcpServers: mcp.kept, choices, prune: input.prune === true });
  return {
    plan: {
      folder: folder.root, ...(input.commit ? { commit: input.commit } : {}), ...(folder.org ? { organization: folder.org.name } : {}),
      digest, lines, counts, noChanges, problems: folder.problems.map(sentence), warnings: folder.warnings.map(sentence),
    },
    actions,
    goneAreas: keptAreas,
    mcpServers: mcp.kept,
  };
}

/** Binds a plan to exactly what applying it writes: every file's bytes, the commit, the lines, every action's payload with
 * its hashes, the areas it forgets, the choices and prune. Security: any change between plan and apply gives a 409. */
function planDigest(input: { folder: PlanInput["folder"]; commit: string | undefined; lines: readonly ProfilePlanLine[]; actions: readonly ProfileAction[];
  goneAreas: readonly string[]; mcpServers: ProfilesState["mcpServers"]; choices: Record<string, ProfileChoice>; prune: boolean }): string {
  const mutations = input.actions.map((action) => (action.kind === "bot" ? { ...action, echo: action.echo.id ?? null } : action));
  return createHash("sha256").update(JSON.stringify({
    folder: input.folder.root, contents: input.folder.contentHash, problems: input.folder.problems, commit: input.commit ?? null, lines: input.lines,
    mutations, goneAreas: input.goneAreas, mcpServers: input.mcpServers, choices: Object.entries(input.choices).sort(([a], [b]) => a.localeCompare(b)), prune: input.prune,
  })).digest("hex").slice(0, 32);
}

/** A conflict with a choice becomes "take" (the file) or "mine". */
function settle(outcome: ReturnType<typeof decide>, choice: ProfileChoice | undefined): ReturnType<typeof decide> | "mine" {
  if (outcome !== "conflict" || !choice) return outcome;
  return choice === "file" ? "take" : "mine";
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export function modelSelection(model: string, effort: string | undefined): Rec {
  const [instanceId, ...rest] = model.split("/");
  return { instanceId, model: rest.join("/"), ...(effort ? { effort } : {}) };
}

export function countLines(lines: readonly ProfilePlanLine[]): ProfilePlanCounts {
  const counts: ProfilePlanCounts = { add: 0, change: 0, access: 0, conflict: 0, changedHere: 0, gone: 0, remove: 0, blocked: 0, later: 0 };
  for (const line of lines) {
    if (line.kind === "changed-here") counts.changedHere += 1;
    else if (line.kind !== "note") counts[line.kind] += 1;
  }
  return counts;
}
