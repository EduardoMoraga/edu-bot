// One fresh in-memory DuckDB per named query. The attached database is the only file it may touch.
import { connect as netConnect } from "node:net";
import { join } from "node:path";
import type * as DuckDB from "@duckdb/node-api";

import { DATA_LIMITS } from "../../shared/data-surface.ts";
import { containsRawDsn } from "../../shared/data-connections.ts";
import type { ConnectionType, StoredConnection } from "./connections.ts";
import { scannerPath } from "./extensions.ts";
import { nativeRequire } from "./engine.ts";
import { DataFailure, type RunResult } from "./types.ts";

type Binding = typeof DuckDB;

const PROBE_MS = 3_000;
const REFUSED = "This statement names something this bot cannot check, so it was not run.";

function binding(): Binding {
  return nativeRequire()("@duckdb/node-api") as Binding;
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
  fn: (connection: DuckDB.DuckDBConnection) => Promise<T>,
): Promise<T> {
  const scanner = options.type === "sqlite" || options.type === "postgres"
    ? await scannerPath(options.type === "sqlite" ? "sqlite_scanner" : "postgres_scanner")
    : null;
  const instance = await binding().DuckDBInstance.create(":memory:", {
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
    if (scanner) await connection.run(`LOAD ${quoteLiteral(scanner)}`);
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

async function runCapped(connection: DuckDB.DuckDBConnection, sql: string, maxRows: number, timeoutMs: number, signal?: AbortSignal): Promise<RunResult> {
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
    const columns = reader.columnNames().map((name, index) => ({ name, type: reader.columnType(index).toString() }));
    return { columns, rows, rowCount: rows.length, truncated: !reader.done, elapsedMs: Date.now() - started };
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function oneStatement(connection: DuckDB.DuckDBConnection, sql: string): Promise<void> {
  const select = binding().StatementType.SELECT;
  let extracted;
  try { extracted = await connection.extractStatements(sql); } catch {
    throw refused();
  }
  if (extracted.count !== 1) throw refused();
  let prepared;
  try { prepared = await extracted.prepare(0); } catch {
    throw refused();
  }
  if (prepared.statementType !== select) throw refused();
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
      await oneStatement(connection, options.sql);
      return runCapped(connection, options.sql, options.maxRows, DATA_LIMITS.sqlTimeoutMs, options.signal);
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
