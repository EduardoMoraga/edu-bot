import { NAMED_CONNECTION_SENTENCE, containsRawDsn } from "../../shared/data-connections.ts";
import { flushDecisionLog } from "../decision-log.ts";
import { executeNamedWrite, explainNamedWrite, log, newRequestId, openNamed, type NamedContext } from "./live.ts";
import { singleStatement } from "./sql-statements.ts";
import { DataFailure } from "./types.ts";

const WRITE_VERBS = new Set(["INSERT", "UPDATE", "DELETE", "MERGE"]);
const WAIT_MS = 120_000;
/** DuckDB 1.5 parses a failed statement again with these spaces removed, so the second reading splits tokens the first one joined. */
const REPARSED_SPACES = /[\u00a0\u2000-\u200b\u202f\u205f\u2060\u3000\ufeff]/;

interface Pending {
  threadId: string;
  resolve(behavior: "allow" | "deny"): void;
}

const pending = new Map<string, Pending>();

export const DATA_WRITE_TOOL = {
  name: "data_write",
  description: "Change rows on a named connection from Settings → Data. INSERT, UPDATE, DELETE or MERGE only. The person always gets an approval card first, even at Full access. Refuses DROP, CREATE, ALTER, ATTACH and COPY.",
  inputSchema: {
    type: "object",
    properties: {
      on: { type: "string", pattern: "^[a-z][a-z0-9_]{0,31}$", description: "The named connection to write." },
      sql: { type: "string", minLength: 1, maxLength: 100000 },
    },
    required: ["on", "sql"],
    additionalProperties: false,
  },
};

export function resolveDataWrite(threadId: string, requestId: string, behavior: string): { ok: true; outcome: string } | null {
  const item = pending.get(requestId);
  if (!item || item.threadId !== threadId) return null;
  if (behavior !== "allow" && behavior !== "deny") return null;
  pending.delete(requestId);
  item.resolve(behavior);
  return { ok: true, outcome: behavior === "allow" ? "allowed" : "denied" };
}

export async function runDataWrite(ctx: NamedContext, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const on = typeof args.on === "string" ? args.on : "";
  const sql = typeof args.sql === "string" ? args.sql : "";
  if (containsRawDsn(sql) || containsRawDsn(on)) throw new DataFailure({ code: "invalid_input", message: NAMED_CONNECTION_SENTENCE });
  if (REPARSED_SPACES.test(sql)) throw new DataFailure({ code: "invalid_input", message: "Replace non-ASCII spaces with plain spaces." });
  let verb = "";
  try { verb = statementVerb(sql); } catch (error) {
    if (error instanceof DataFailure && error.error.sql && containsRawDsn(error.error.sql)) delete error.error.sql;
    throw error;
  }
  if (!WRITE_VERBS.has(verb.split(" ")[0] ?? verb)) {
    throw new DataFailure({ code: "write_refused", message: `${verb || "That statement"} is not a write data_write can run.` });
  }
  let opened;
  try {
    opened = openNamed(ctx, on, sql, "write");
    await explainNamedWrite(ctx, opened, sql);
  } catch (error) {
    if (error instanceof DataFailure) log(ctx, { tool: "data_write", decision: "auto-denied", rule: on, summary: error.error.message });
    throw error;
  }
  const requestId = newRequestId();
  const behavior = await wait(ctx, requestId, on, statementPreview(sql));
  if (behavior !== "allow") {
    log(ctx, { tool: "data_write", decision: behavior === "deny" ? "user-denied" : "auto-denied", rule: on, summary: `write ${on} was not allowed`, requestId });
    throw new DataFailure({ code: "write_refused", message: "The write was not allowed." });
  }
  log(ctx, { tool: "data_write", decision: "user-approved", rule: on, summary: `write ${on}`, requestId });
  await flushDecisionLog(ctx.named!.dataDir);
  await executeNamedWrite(ctx, opened, sql);
  return { connection: on, verb, ok: true };
}

function statementPreview(sql: string): string {
  let rest = sql;
  for (;;) {
    const trimmed = rest.trimStart();
    if (trimmed.startsWith("/*")) {
      const end = trimmed.indexOf("*/");
      if (end < 0) break;
      rest = trimmed.slice(end + 2);
      continue;
    }
    if (trimmed.startsWith("--")) {
      const end = trimmed.indexOf("\n");
      rest = end < 0 ? "" : trimmed.slice(end + 1);
      continue;
    }
    rest = trimmed;
    break;
  }
  const collapsed = rest.replace(/\s+/g, " ").trim();
  return collapsed.length > 500 ? `${collapsed.slice(0, 500)}…` : collapsed;
}

function wait(ctx: NamedContext, requestId: string, on: string, sql: string): Promise<"allow" | "deny" | "timeout"> {
  const named = ctx.named!;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (behavior: "allow" | "deny" | "timeout") => {
      if (settled) return;
      settled = true;
      pending.delete(requestId);
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", onAbort);
      resolve(behavior);
    };
    const timer = setTimeout(() => finish("timeout"), WAIT_MS);
    timer.unref();
    const onAbort = () => finish("timeout");
    pending.set(requestId, { threadId: named.threadId, resolve: (behavior) => finish(behavior) });
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    const title = `Write to ${on}?`;
    named.postCard(title, { title, subtitle: sql, options: ["Allow", "Deny"], requestId, tool: "data_write", requestType: "permission" });
    log(ctx, { tool: "data_write", decision: "card-shown", rule: on, summary: title, requestId });
  });
}

function statementVerb(sql: string): string {
  const { tokens } = singleStatement(sql);
  let i = 0;
  let verb = tokens[0]?.kind === "word" ? tokens[0].text : "";
  if (verb !== "WITH") return verb;
  i = 1;
  if (tokens[i]?.text === "RECURSIVE") i++;
  for (;;) {
    while (i < tokens.length && tokens[i]?.kind !== "block") i++;
    i++;
    if (tokens[i]?.text === "AS") {
      while (i < tokens.length && tokens[i]?.kind !== "block") i++;
      i++;
    }
    if (tokens[i]?.kind === "punct") { i++; continue; }
    break;
  }
  return tokens[i]?.kind === "word" ? tokens[i].text : "";
}
