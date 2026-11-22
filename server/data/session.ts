// One fresh in-memory DuckDB per named query. The attached database is the only file it may touch.
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { connect as netConnect } from "node:net";
import { join } from "node:path";
import { DuckDBInstance, StatementType, type DuckDBConnection } from "@duckdb/node-api";

import { DATA_LIMITS } from "../../shared/data-surface.ts";
import { containsRawDsn } from "../../shared/data-connections.ts";
import type { ConnectionType, StoredConnection } from "./connections.ts";
import { DataFailure, type RunResult } from "./types.ts";

const require = createRequire(import.meta.url);
const WRITE_TYPES = new Set<StatementType>([StatementType.INSERT, StatementType.UPDATE, StatementType.DELETE, StatementType.MERGE_INTO]);
const BAD_OPERATOR = /^(?:READ_CSV|READ_PARQUET|READ_JSON|READ_TEXT|READ_BLOB|GLOB|PARQUET_SCAN|CSV_SCAN|JSON_SCAN)$/;
const BAD_FUNCTION = /"(?:read_csv(?:_auto)?|read_parquet|read_json(?:_auto)?|read_ndjson(?:_auto)?|read_text|read_blob|glob|getenv|current_setting|postgres_scan|mysql_scan)"/;
const PROBE_MS = 3_000;
const REFUSED = "This statement names something this bot cannot check, so it was not run.";

export interface PlanTable {
  schema: string;
  table: string;
}

function libraryVersion(): string {
  const api = require.resolve("@duckdb/node-api");
  const bindings = createRequire(api).resolve("@duckdb/node-bindings");
  return (createRequire(bindings)("@duckdb/node-bindings") as { library_version(): string }).library_version();
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, "\"\"")}"`;
}

function quoteLiteral(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

function scrub(error: unknown, secrets: string[]): string {
  const message = error instanceof Error ? error.message : String(error);
  const first = message.split("\n")[0] ?? "";
  if (containsRawDsn(first) || secrets.some((secret) => secret.length > 0 && first.includes(secret))) return "The connection could not be opened.";
  if (/permission error|file system operations are disabled|cannot access file/i.test(first)) return "That statement reads a file or another database.";
  return first.slice(0, 300);
}

function refused(message = REFUSED): DataFailure {
  return new DataFailure({ code: "write_refused", message });
}

async function withSession<T>(
  options: { dataDir: string; type: ConnectionType; alias: string; target: string; readOnly: boolean },
  fn: (connection: DuckDBConnection) => Promise<T>,
): Promise<T> {
  const instance = await DuckDBInstance.create(":memory:", {
    extension_directory: join(options.dataDir, "duckdb-extensions", libraryVersion()),
    temp_directory: join(options.dataDir, "duckdb-tmp"),
    max_temp_directory_size: "1GB",
    autoinstall_known_extensions: "false",
    autoload_known_extensions: "false",
    allow_persistent_secrets: "false",
    memory_limit: "256MiB",
    threads: "1",
  });
  const connection = await instance.connect();
  try {
    if (options.type === "sqlite" || options.type === "postgres") {
      await connection.run(`INSTALL ${options.type} FROM core`);
      await connection.run(`LOAD ${options.type}`);
    }
    const alias = quoteIdent(options.alias);
    const literal = quoteLiteral(options.target);
    const attach = options.type === "duckdb"
      ? `ATTACH ${literal} AS ${alias}${options.readOnly ? " (READ_ONLY)" : ""}`
      : `ATTACH ${literal} AS ${alias} (TYPE ${options.type}${options.readOnly ? ", READ_ONLY" : ""})`;
    await connection.run(attach);
    await connection.run("SET enable_external_access = false");
    await connection.run("SET lock_configuration = true");
    const schema = options.type === "postgres" ? "public" : "main";
    await connection.run(`USE ${alias}.${quoteIdent(schema)}`);
    return await fn(connection);
  } finally {
    try { connection.closeSync(); } catch { /* the statement already finished */ }
    try { instance.closeSync(); } catch { /* the statement already finished */ }
  }
}

async function runCapped(connection: DuckDBConnection, sql: string, maxRows: number, timeoutMs: number, signal?: AbortSignal): Promise<RunResult> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => { void connection.interrupt(); };
  signal?.addEventListener("abort", onAbort);
  try {
    const reader = await Promise.race([
      connection.runAndReadUntil(sql, Math.max(1, maxRows)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          void connection.interrupt();
          reject(new DataFailure({ code: "timeout", message: "The statement timed out.", retryable: true }));
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
    const rows = reader.getRowsJson() as RunResult["rows"];
    const columns = reader.columnNames().map((name, index) => ({ name, type: columnType(reader.columnTypeJson(index)) }));
    return { columns, rows, rowCount: rows.length, truncated: !reader.done, elapsedMs: Date.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function columnType(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof (value as { id: unknown }).id === "string") return (value as { id: string }).id;
  return "VARCHAR";
}

async function oneStatement(connection: DuckDBConnection, sql: string, allowed: Set<StatementType>): Promise<void> {
  let extracted;
  try { extracted = await connection.extractStatements(sql); } catch {
    throw refused();
  }
  if (extracted.count !== 1) throw refused();
  let prepared;
  try { prepared = await extracted.prepare(0); } catch {
    throw refused();
  }
  if (!allowed.has(prepared.statementType)) throw refused();
}

interface PlanNode {
  name?: string;
  children?: PlanNode[];
  extra_info?: Record<string, unknown>;
}

function reviewPlan(nodes: PlanNode[], attached: string | null): { ok: true; tables: PlanTable[] } | { ok: false } {
  const tables: PlanTable[] = [];
  const files: string[] = [];
  let unsafe = BAD_FUNCTION.test(JSON.stringify(nodes));
  const walk = (node: PlanNode) => {
    if (!node || typeof node !== "object") return;
    if (node.name && BAD_OPERATOR.test(node.name)) unsafe = true;
    const info = node.extra_info ?? {};
    const table = stringField(info, "Table") ?? stringField(info, "Table Name");
    if (table) tables.push({ schema: stringField(info, "Schema") ?? stringField(info, "Schema Name") ?? "", table });
    const file = stringField(info, "File");
    if (file) files.push(file);
    for (const child of node.children ?? []) walk(child);
  };
  for (const node of nodes) walk(node);
  if (unsafe || !tables.length) return { ok: false };
  const expected = attached ? tryReal(attached) : null;
  for (const file of files) {
    const real = tryReal(file);
    if (!expected || !real || real !== expected) return { ok: false };
  }
  return { ok: true, tables };
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value ? value : undefined;
}

function tryReal(path: string): string | null {
  try { return realpathSync(path); } catch { return null; }
}

function planNodes(rows: unknown[][]): PlanNode[] {
  for (const row of rows) {
    for (const cell of row) {
      if (typeof cell !== "string" || !/^\s*[[{]/.test(cell)) continue;
      const parsed = JSON.parse(cell) as unknown;
      if (Array.isArray(parsed)) return parsed as PlanNode[];
      if (parsed && typeof parsed === "object") return [parsed as PlanNode];
    }
  }
  return [];
}

export async function runNamedRead(options: {
  dataDir: string;
  connection: StoredConnection;
  target: string;
  sql: string;
  maxRows: number;
  signal?: AbortSignal;
}): Promise<RunResult> {
  try {
    return await withSession({
      dataDir: options.dataDir, type: options.connection.type, alias: options.connection.name, target: options.target, readOnly: true,
    }, async (connection) => {
      await oneStatement(connection, options.sql, new Set([StatementType.SELECT]));
      return runCapped(connection, options.sql, options.maxRows, DATA_LIMITS.sqlTimeoutMs, options.signal);
    });
  } catch (error) {
    if (error instanceof DataFailure) throw error;
    throw new DataFailure({ code: "sql_error", message: scrub(error, [options.target]) });
  }
}

export async function runNamedWrite(options: {
  dataDir: string;
  connection: StoredConnection;
  target: string;
  sql: string;
  signal?: AbortSignal;
  dryRun?: boolean;
  allow(table: PlanTable): boolean;
}): Promise<void> {
  const attached = options.connection.type === "postgres" ? null : options.target;
  try {
    await withSession({
      dataDir: options.dataDir, type: options.connection.type, alias: options.connection.name, target: options.target, readOnly: false,
    }, async (connection) => {
      await oneStatement(connection, options.sql, WRITE_TYPES);
      let nodes: PlanNode[] = [];
      try {
        const explained = await connection.runAndReadAll(`EXPLAIN (FORMAT JSON) ${options.sql}`);
        nodes = planNodes(explained.getRowsJson());
      } catch {
        throw refused();
      }
      const reviewed = reviewPlan(nodes, attached);
      if (!reviewed.ok) throw refused();
      for (const table of reviewed.tables) {
        if (!options.allow(table)) throw refused(`This bot may not write ${table.table} on ${options.connection.name}.`);
      }
      if (options.dryRun) return;
      await runCapped(connection, options.sql, 1, DATA_LIMITS.sqlTimeoutMs, options.signal);
    });
  } catch (error) {
    if (error instanceof DataFailure) throw error;
    throw new DataFailure({ code: "sql_error", message: scrub(error, [options.target]) });
  }
}

function reachable(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect({ host, port });
    const finish = (ok: boolean) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/** Opens the connection and runs SELECT 1. The error never includes the connection string. */
export async function probeConnection(options: { dataDir: string; type: ConnectionType; alias: string; target: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (options.type === "postgres") {
    let url: URL;
    try { url = new URL(options.target); } catch { return { ok: false, error: "The connection could not be opened." }; }
    const port = Number(url.port || 5432);
    if (!url.hostname || !await reachable(url.hostname, port, PROBE_MS)) return { ok: false, error: "The connection could not be opened." };
  }
  try {
    await withSession({ dataDir: options.dataDir, type: options.type, alias: options.alias, target: options.target, readOnly: true }, async (connection) => {
      await runCapped(connection, "SELECT 1", 1, PROBE_MS);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: scrub(error, [options.target]) };
  }
}
