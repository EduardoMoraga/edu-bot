import { randomUUID } from "node:crypto";

import { NAMED_CONNECTION_SENTENCE, containsRawDsn, type DataGrant, type DataGrantMap } from "../../shared/data-connections.ts";
import { appendDecision } from "../decision-log.ts";
import { ConnectionStore, type ConnectionType, type StoredConnection } from "./connections.ts";
import { inspectSql, isPathTable, type SqlTable } from "./sql-shape.ts";
import { runNamedRead, runNamedWrite, type PlanTable } from "./session.ts";
import { DataFailure, type BotDatabase, type DataConnection, type RunResult } from "./types.ts";

export interface DataWriteCard {
  title: string;
  subtitle: string;
  options: string[];
  requestId: string;
  tool: string;
  requestType: "permission";
}

export interface NamedDataAccess {
  botId: string;
  threadId: string;
  dataDir: string;
  allowlist(): DataGrantMap | undefined;
  secret(id: string): string | null;
  postCard(text: string, card: DataWriteCard): void;
}

export interface NamedContext {
  database: BotDatabase;
  signal: AbortSignal;
  connection: DataConnection;
  named?: NamedDataAccess;
}

const fail = (message: string) => new DataFailure({ code: "invalid_input", message });
const refused = (message: string) => new DataFailure({ code: "write_refused", message });

const CATALOG_SCHEMAS = new Set(["information_schema", "pg_catalog", "duckdb_catalog", "system"]);
const CATALOG_TABLES = new Set([
  "sqlite_master", "sqlite_schema", "sqlite_temp_master",
  "duckdb_tables", "duckdb_views", "duckdb_schemas", "duckdb_columns",
  "duckdb_databases", "duckdb_functions", "duckdb_settings",
]);

export function defaultSchema(type: ConnectionType): string {
  return type === "postgres" ? "public" : "main";
}

export interface OpenedConnection {
  connection: StoredConnection;
  grant: DataGrant;
  target: string;
}

export async function queryNamed(ctx: NamedContext, input: { sql: string; on: string; limit: number }): Promise<RunResult & { elapsedMs: number }> {
  const started = Date.now();
  const named = ctx.named;
  let opened: OpenedConnection;
  try {
    opened = openNamed(ctx, input.on, input.sql, "read");
    const inspected = await inspectSql(input.sql, "named");
    if (!inspected.ok) throw refused("This statement names something this bot cannot check, so it was not run.");
    for (const table of inspected.tables) {
      if (!relationAllowed(table, opened.grant, opened.connection)) throw refused(`This bot may not read ${table.table} on ${input.on}.`);
    }
  } catch (error) {
    if (error instanceof DataFailure) log(ctx, { tool: "data_sql", decision: "auto-denied", rule: input.on, summary: error.error.message });
    throw error;
  }
  const result = await runNamedRead({
    dataDir: named!.dataDir, connection: opened.connection, target: opened.target, sql: input.sql, maxRows: input.limit + 1, signal: ctx.signal,
  });
  log(ctx, { tool: "data_sql", decision: "auto-approved", rule: opened.connection.name, summary: `read ${opened.connection.name}` });
  return { ...result, elapsedMs: Date.now() - started };
}

export function openNamed(ctx: NamedContext, on: string, sql: string, mode: "read" | "write"): OpenedConnection {
  if (containsRawDsn(sql) || containsRawDsn(on)) throw fail(NAMED_CONNECTION_SENTENCE);
  const named = ctx.named;
  if (!named) throw fail("Named connections are not set up on this call.");
  const store = openStore(named);
  const connection = store.get(on);
  if (!connection) throw fail(`There is no data connection named ${on}. Add it in Settings → Data.`);
  const grant = named.allowlist()?.[on];
  if (!grant) throw refused(`This bot may not use ${on}.`);
  if (mode === "write" && grant.write !== "ask") throw refused(`This bot may not write to ${on}.`);
  let target: string;
  try {
    target = store.target(connection);
  } catch (error) {
    throw fail(error instanceof Error && !containsRawDsn(error.message) ? error.message : "That connection could not be opened.");
  }
  return { connection, grant, target };
}

/** An empty catalog is the attached database. Catalog objects stay closed unless the grant names them. */
export function relationAllowed(table: SqlTable, grant: DataGrant, connection: StoredConnection): boolean {
  if (isPathTable(table.table)) return false;
  const catalog = table.catalog.toLowerCase();
  if (catalog && catalog !== connection.name.toLowerCase()) return false;
  const schema = (table.schema || defaultSchema(connection.type)).toLowerCase();
  const name = table.table.toLowerCase();
  const catalogObject = CATALOG_SCHEMAS.has(schema) || CATALOG_TABLES.has(name);
  if (catalogObject) {
    const explicitSchema = grant.schemas?.some((item) => item.toLowerCase() === schema) ?? false;
    const explicitTable = grant.tables?.some((item) => item.toLowerCase().split(".").filter(Boolean).at(-1) === name) ?? false;
    if (!explicitSchema && !explicitTable) return false;
  }
  if (grant.schemas?.length && !grant.schemas.some((item) => item.toLowerCase() === schema)) return false;
  if (grant.tables?.length) {
    const listed = grant.tables.some((item) => {
      const parts = item.toLowerCase().split(".").filter(Boolean);
      if (parts.length === 1) return parts[0] === name;
      return parts.at(-1) === name && parts.at(-2) === schema;
    });
    if (!listed) return false;
  }
  return true;
}

export function writeTableAllowed(table: PlanTable, grant: DataGrant, connection: StoredConnection): boolean {
  return relationAllowed({ catalog: "", schema: table.schema, table: table.table }, grant, connection);
}

export async function explainNamedWrite(ctx: NamedContext, opened: OpenedConnection, sql: string): Promise<void> {
  const named = ctx.named!;
  await runNamedWrite({
    dataDir: named.dataDir, connection: opened.connection, target: opened.target, sql, signal: ctx.signal, dryRun: true,
    allow: (table) => writeTableAllowed(table, opened.grant, opened.connection),
  });
}

export async function executeNamedWrite(ctx: NamedContext, opened: OpenedConnection, sql: string): Promise<void> {
  const named = ctx.named!;
  await runNamedWrite({
    dataDir: named.dataDir, connection: opened.connection, target: opened.target, sql, signal: ctx.signal,
    allow: (table) => writeTableAllowed(table, opened.grant, opened.connection),
  });
}

export function openStore(named: NamedDataAccess): ConnectionStore {
  return new ConnectionStore(named.dataDir, { secret: (id) => { const value = named.secret(id); return value === null ? null : { value }; } });
}

export function log(ctx: NamedContext, row: { tool: string; decision: "auto-approved" | "auto-denied" | "card-shown" | "user-approved" | "user-denied"; rule?: string; summary: string; requestId?: string }): void {
  const named = ctx.named;
  if (!named) return;
  const summary = containsRawDsn(row.summary) ? NAMED_CONNECTION_SENTENCE : row.summary;
  appendDecision(named.dataDir, {
    threadId: named.threadId, botId: named.botId, tool: row.tool, decision: row.decision, source: "data",
    summary, ...(row.rule ? { rule: row.rule } : {}), ...(row.requestId ? { requestId: row.requestId } : {}),
  });
}

export function newRequestId(): string {
  return randomUUID();
}
