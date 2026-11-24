import { createHash } from "node:crypto";

import type { McpServerProfile, ProfileProblem, SecretRef } from "../../shared/profile-format.ts";
import type { ProfileChoice, ProfilePlanLine } from "../../shared/profile-plan.ts";
import { vaultNameKey, type VaultSecret } from "../../shared/vault.ts";
import { isRemoteMcpServer, parseStoredMcpServer } from "../mcp-registry.ts";
import { vaultPointer } from "../vault/mcp-keys.ts";
import { ENGLISH_PLAN, sayList, type PlanSay } from "./plan-words.ts";
import type { ProfilesState } from "./state.ts";

type McpState = ProfilesState["mcpServers"];

/** What a profile sets of a server. Its on/off switch and the app's own settings for it (result size, apps in chat,
 * sign-in app) stay the app's. A Vault key is a `vault:<id>` pointer, never its value. */
export type ProfileMcpSpec =
  | { type: "http" | "sse"; url: string; headers: Record<string, string> }
  | { command: string; args: string[]; env: Record<string, string> };

export interface McpServerAction {
  kind: "mcp-server";
  key: string;
  op: "add" | "change" | "remove";
  line: ProfilePlanLine;
  access: boolean;
  spec?: ProfileMcpSpec;
  /** The app's own settings for the server, sent back unchanged so a write never drops them. */
  keep?: Record<string, unknown>;
  /** The switch after the write; absent keeps the server's. */
  enabled?: boolean;
  /** The Vault items the spec points at, given to this server only. */
  vaultKeys: string[];
  /** What profiles.json keeps for the server once the write is done. */
  state?: McpState[string];
}

export interface McpPlanInput {
  servers: readonly McpServerProfile[];
  problems: readonly ProfileProblem[];
  blockedAll: boolean;
  /** The app's servers as config.json keeps them, by name. */
  app: Record<string, unknown>;
  /** The id of the team Vault secret each slot name finds. */
  vault: Record<string, string>;
  state: McpState;
  choices: Record<string, ProfileChoice>;
  prune: boolean;
  /** The plan's words; English when absent. */
  say?: PlanSay;
}

export interface McpPlanOutput {
  lines: ProfilePlanLine[];
  actions: McpServerAction[];
  /** What profiles.json keeps whatever applying does; a done write replaces its server's entry. */
  kept: McpState;
  /** Conflicts settled as "keep mine". */
  settled: number;
}

/** The team Vault secret each slot name finds, as `usableSecret` picks among the team's: one for every bot before one kept
 * to some bots, then the newest. */
export function teamVaultSecretIds(secrets: readonly VaultSecret[], names: readonly string[]): Record<string, string> {
  const found: Record<string, string> = {};
  for (const name of names) {
    const key = vaultNameKey(name);
    const best = secrets.filter((secret) => vaultNameKey(secret.name) === key)
      .sort((a, b) => Number(a.bots !== "all") - Number(b.bots !== "all") || b.updatedAt - a.updatedAt)[0];
    if (best) found[name] = best.id;
  }
  return found;
}

const hashOf = (value: unknown) => createHash("sha256").update(JSON.stringify(value) ?? "null").digest("hex").slice(0, 16);
const sortedRecord = (record: Record<string, string>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
const specHash = (spec: ProfileMcpSpec | null) => hashOf(spec === null ? null
  : "url" in spec ? { type: spec.type, url: spec.url, headers: sortedRecord(spec.headers) } : { command: spec.command, args: spec.args, env: sortedRecord(spec.env) });

const quoted = (arg: string) => /^[\w@+=:,./-]+$/.test(arg) ? arg : JSON.stringify(arg);
const commandLine = (server: McpServerProfile) => [server.command ?? "", ...(server.args ?? [])].map(quoted).join(" ");

function valueWords(say: PlanSay, name: string, value: string | SecretRef): string {
  if (typeof value === "string") return say("server.profiles.mcp.valueSet", { name, value });
  if ("secret" in value) return say("server.profiles.mcp.valueSecret", { name, secret: value.secret });
  return "env" in value ? say("server.profiles.mcp.valueEnv", { name, env: value.env }) : say("server.profiles.mcp.valueFile", { name });
}

function describe(say: PlanSay, server: McpServerProfile): string {
  if (server.transport === "stdio") {
    const env = Object.entries(server.env ?? {}).map(([name, value]) => valueWords(say, say("server.profiles.mcp.variable", { name }), value));
    return env.length ? say("server.profiles.mcp.runsWith", { command: commandLine(server), values: sayList(say, env) }) : say("server.profiles.mcp.runs", { command: commandLine(server) });
  }
  const headers = Object.entries(server.headers ?? {}).map(([name, value]) => valueWords(say, say("server.profiles.mcp.header", { name }), value));
  const url = `${server.url}${server.transport === "sse" ? " (SSE)" : ""}`;
  return headers.length ? say("server.profiles.mcp.atSending", { url, values: sayList(say, headers) }) : say("server.profiles.mcp.at", { url });
}

/** The server as this app would store it, with each secret slot pointing at the team's Vault secret of that name. */
function resolve(server: McpServerProfile, vault: Record<string, string>) {
  const missing: string[] = [];
  const unread: string[] = [];
  const keys: string[] = [];
  const fill = (values: Record<string, string | SecretRef> | undefined) => {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(values ?? {})) {
      if (typeof value === "string") out[name] = value;
      else if ("secret" in value) {
        const id = Object.hasOwn(vault, value.secret) ? vault[value.secret] : undefined;
        if (id) { out[name] = vaultPointer(id); keys.push(id); } else missing.push(value.secret);
      } else unread.push(name);
    }
    return out;
  };
  const spec: ProfileMcpSpec = server.transport === "stdio"
    ? { command: server.command ?? "", args: server.args ?? [], env: fill(server.env) }
    : { type: server.transport, url: server.url ?? "", headers: fill(server.headers) };
  return { spec, missing: [...new Set(missing)], unread, keys: [...new Set(keys)] };
}

function offReason(say: PlanSay, missing: readonly string[], unread: readonly string[]): string | null {
  if (missing.length) return say("server.profiles.mcp.missingKey", { names: sayList(say, missing) });
  if (unread.length) return say("server.profiles.mcp.unreadKey");
  return null;
}

/** The parts a profile sets of the app's server, and the app's own settings for it, or null when it cannot be read. */
function appSide(name: string, raw: unknown): { spec: ProfileMcpSpec; keep: Record<string, unknown>; enabled: boolean } | null {
  const parsed = parseStoredMcpServer(name, raw);
  if (!parsed.ok) return null;
  const server = parsed.server;
  const keep: Record<string, unknown> = server.resultBudget !== undefined ? { resultBudget: server.resultBudget } : {};
  if (isRemoteMcpServer(server)) {
    if (server.oauth) {
      keep.oauth = { clientId: server.oauth.clientId, ...(server.oauth.scopes ? { scopes: server.oauth.scopes } : {}), ...(server.oauth.clientSecret ? { clientSecret: true } : {}) };
    }
    return { spec: { type: server.type, url: server.url, headers: server.headers }, keep, enabled: server.enabled };
  }
  return { spec: { command: server.command, args: server.args, env: server.env }, keep, enabled: server.enabled };
}

/** Whether `want` lets a bot do anything `have` does not: another address or command, or a header or variable it lacks. */
function widens(have: ProfileMcpSpec, want: ProfileMcpSpec): boolean {
  if ("url" in want !== "url" in have) return true;
  if ("url" in want && "url" in have) {
    return have.url !== want.url || have.type !== want.type || Object.entries(want.headers).some(([name, value]) => have.headers[name] !== value);
  }
  if ("command" in want && "command" in have) {
    return have.command !== want.command || JSON.stringify(have.args) !== JSON.stringify(want.args)
      || Object.entries(want.env).some(([name, value]) => have.env[name] !== value);
  }
  return true;
}

function changeWords(say: PlanSay, server: McpServerProfile, have: ProfileMcpSpec, want: ProfileMcpSpec): string[] {
  if ("url" in want !== "url" in have) return [say("server.profiles.mcp.becomes", { where: describe(say, server) })];
  const words: string[] = [];
  const parts = (from: Record<string, string>, to: Record<string, string>, fileValues: Record<string, string | SecretRef> | undefined, what: "server.profiles.mcp.header" | "server.profiles.mcp.variable") => {
    for (const name of [...new Set([...Object.keys(from), ...Object.keys(to)])].sort()) {
      if (!Object.hasOwn(to, name)) words.push(say("server.profiles.mcp.stopsSending", { name: say(what, { name }) }));
      else if (from[name] !== to[name]) words.push(say("server.profiles.mcp.sends", { value: valueWords(say, say(what, { name }), fileValues?.[name] ?? to[name]!) }));
    }
  };
  if ("url" in want && "url" in have) {
    if (have.url !== want.url || have.type !== want.type) words.push(say("server.profiles.mcp.address", { from: have.url, to: `${want.url}${want.type === "sse" ? " (SSE)" : ""}` }));
    parts(have.headers, want.headers, server.headers, "server.profiles.mcp.header");
  } else if ("command" in want && "command" in have) {
    if (have.command !== want.command || JSON.stringify(have.args) !== JSON.stringify(want.args)) words.push(say("server.profiles.mcp.nowRuns", { command: commandLine(server) }));
    parts(have.env, want.env, server.env, "server.profiles.mcp.variable");
  }
  return words;
}

const decide = (base: string | undefined, file: string, app: string): "same" | "take" | "here" | "conflict" =>
  file === app ? "same" : base === undefined || app === base ? "take" : file === base ? "here" : "conflict";

/** Compares the folder's `mcp/` servers with this app's, as plan lines and the writes applying them makes. A server
 * no profile made is never touched; one a profile made and the folder no longer has is kept unless the plan prunes. */
export function planMcpServers(input: McpPlanInput): McpPlanOutput {
  const say = input.say ?? ENGLISH_PLAN;
  const lines: ProfilePlanLine[] = [];
  const actions: McpServerAction[] = [];
  const kept: McpState = {};
  let settled = 0;
  if (input.blockedAll) return { lines, actions, kept: { ...input.state }, settled };
  const blocked = (key: string) => input.problems.some((problem) => problem.file === "mcp" || problem.file.toLowerCase() === `mcp/${key}.md`);
  const has = (key: string) => Object.hasOwn(input.app, key);

  for (const server of input.servers) {
    const { key, file } = server;
    const subject = { kind: "mcp-server" as const, id: key, name: say("server.profiles.mcp.subject", { key }) };
    const line = (kind: ProfilePlanLine["kind"], text: string, extra: Partial<ProfilePlanLine> = {}): ProfilePlanLine => ({ kind, subject, field: "server", file, text, ...extra });
    const about = (text: string) => say("server.profiles.labelled", { what: subject.name, text });
    const then = (text: string, more: string | null) => (more ? say("server.profiles.then", { text, more }) : text);
    const base = Object.hasOwn(input.state, key) ? input.state[key] : undefined;
    const { spec, missing, unread, keys } = resolve(server, input.vault);
    const off = offReason(say, missing, unread);
    const stdio = server.transport === "stdio";
    const fileHash = specHash(spec);
    const applied = { hash: fileHash, ...(off ? { needsKey: true as const } : {}) };

    if (!has(key)) {
      const suffix = off ?? (stdio ? say("server.profiles.mcp.confirm") : null);
      const added = line("access", then(say("server.profiles.mcp.adds", { key, where: describe(say, server) }), suffix));
      lines.push(added);
      actions.push({ kind: "mcp-server", key, op: "add", line: added, access: true, spec, enabled: !off && !stdio, vaultKeys: keys, state: applied });
      continue;
    }
    if (!base) {
      lines.push(line("note", about(say("server.profiles.mcp.notOurs"))));
      continue;
    }
    const current = appSide(key, input.app[key]);
    const choice = `mcp:${key}`;
    let outcome: ReturnType<typeof decide> | "mine" = decide(base.hash, fileHash, specHash(current?.spec ?? null));
    if (outcome === "conflict" && input.choices[choice]) outcome = input.choices[choice] === "file" ? "take" : "mine";
    if (outcome === "mine") {
      settled += 1;
      kept[key] = { ...base, hash: fileHash };
      lines.push(line("note", about(say("server.profiles.kept"))));
      continue;
    }
    if (outcome === "same") {
      if (off && current?.enabled) {
        kept[key] = base;
        const turnedOff = line("change", about(off));
        lines.push(turnedOff);
        actions.push({ kind: "mcp-server", key, op: "change", line: turnedOff, access: false, spec, ...(current ? { keep: current.keep } : {}), enabled: false, vaultKeys: keys, state: applied });
        continue;
      }
      kept[key] = applied;
      if (off) lines.push(line("note", about(off)));
      continue;
    }
    kept[key] = base;
    if (outcome === "here") {
      lines.push(line("changed-here", about(say("server.profiles.mcp.changedHere"))));
      continue;
    }
    if (outcome === "conflict") {
      lines.push(line("conflict", about(say("server.profiles.mcp.bothChanged")),
        { conflict: { choice, file: describe(say, server), mine: say("server.profiles.mcp.asChangedHere") } }));
      continue;
    }
    const access = !current || widens(current.spec, spec);
    const enabled = off || stdio ? false : base.needsKey ? true : undefined;
    const suffix = off ?? (stdio ? say("server.profiles.mcp.confirm") : base.needsKey ? say("server.profiles.mcp.turnedOn") : null);
    const what = current ? sayList(say, changeWords(say, server, current.spec, spec)) : say("server.profiles.mcp.becomes", { where: describe(say, server) });
    const changed = line(access ? "access" : "change", about(then(what, suffix)));
    lines.push(changed);
    actions.push({ kind: "mcp-server", key, op: "change", line: changed, access, spec, ...(current ? { keep: current.keep } : {}), ...(enabled === undefined ? {} : { enabled }), vaultKeys: keys, state: applied });
  }

  const inFolder = new Set(input.servers.map((server) => server.key));
  for (const [key, base] of Object.entries(input.state)) {
    if (inFolder.has(key)) continue;
    const subject = { kind: "mcp-server" as const, id: key, name: say("server.profiles.mcp.subject", { key }) };
    const file = `mcp/${key}.md`;
    if (blocked(key)) {
      kept[key] = base;
      if (has(key)) lines.push({ kind: "blocked", subject, field: "server", file, text: say("server.profiles.blockedOne", { file, name: subject.name }) });
      continue;
    }
    if (!has(key)) continue;
    kept[key] = base;
    if (input.prune) {
      const removed: ProfilePlanLine = { kind: "remove", subject, field: "server", file, text: say("server.profiles.bot.deletes", { name: subject.name }) };
      lines.push(removed);
      actions.push({ kind: "mcp-server", key, op: "remove", line: removed, access: false, vaultKeys: [] });
    } else {
      lines.push({ kind: "gone", subject, field: "server", file, text: say("server.profiles.bot.gone", { name: subject.name }) });
    }
  }
  return { lines, actions, kept, settled };
}
