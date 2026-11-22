// DuckDB 1.5: enable_external_access is instance-global and cannot be turned back on while that database is running.
import type * as DuckDB from "@duckdb/node-api";

import { DATA_LIMITS } from "../../shared/data-surface.ts";
import { nativeRequire } from "./engine.ts";
import { DataFailure, type RunResult } from "./types.ts";

const FILE_SENTENCE = "That statement reads a file or another database. Load a file with data_load from an allowed folder, or query a named connection.";

interface LockedOptions {
  maxRows?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

type Binding = typeof DuckDB;

function binding(): Binding {
  return nativeRequire()("@duckdb/node-api") as Binding;
}

function quoteLiteral(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

function columnType(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof (value as { id: unknown }).id === "string") return (value as { id: string }).id;
  return "VARCHAR";
}

function lockedFailure(error: unknown, sql: string): DataFailure {
  if (error instanceof DataFailure) return error;
  const message = error instanceof Error ? error.message : String(error);
  const first = message.split("\n")[0] ?? "";
  if (/permission error|file system operations are disabled|cannot access file|disabled by configuration/i.test(first)) {
    return new DataFailure({ code: "write_refused", message: FILE_SENTENCE, sql });
  }
  if (error instanceof Error && error.name === "AbortError") return new DataFailure({ code: "cancelled", message: "The statement was cancelled.", sql });
  return new DataFailure({ code: "sql_error", message: first.slice(0, 300), sql });
}

async function withLocked<T>(dbFile: string, options: LockedOptions, sql: string, fn: (connection: DuckDB.DuckDBConnection) => Promise<T>): Promise<T> {
  const api = binding();
  const instance = await api.DuckDBInstance.create(":memory:", {
    autoinstall_known_extensions: "false",
    autoload_known_extensions: "false",
    memory_limit: "256MiB",
    threads: "1",
  });
  const connection = await instance.connect();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = () => { void connection.interrupt(); };
  options.signal?.addEventListener("abort", onAbort);
  try {
    if (options.signal?.aborted) throw new DataFailure({ code: "cancelled", message: "Cancelled before it ran.", sql });
    await connection.run(`ATTACH ${quoteLiteral(dbFile)} AS bot (READ_ONLY)`);
    await connection.run("USE bot.main");
    await connection.run("SET enable_external_access = false");
    await connection.run("SET lock_configuration = true");
    const timeoutMs = options.timeoutMs ?? DATA_LIMITS.sqlTimeoutMs;
    return await Promise.race([
      fn(connection),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          void connection.interrupt();
          reject(new DataFailure({ code: "timeout", message: "The statement timed out.", retryable: true, sql }));
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } catch (error) {
    throw lockedFailure(error, sql);
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    try { connection.closeSync(); } catch { /* the statement already finished */ }
    try { instance.closeSync(); } catch { /* the statement already finished */ }
  }
}

type Reader = Awaited<ReturnType<DuckDB.DuckDBConnection["runAndReadAll"]>>;

function asResult(reader: Reader, started: number, maxRows: number): RunResult {
  const all = reader.getRowsJson() as RunResult["rows"];
  const rows = all.slice(0, maxRows);
  const columns = reader.columnNames().map((name, index) => ({ name, type: columnType(reader.columnTypeJson(index)) }));
  return { columns, rows, rowCount: rows.length, truncated: !reader.done, elapsedMs: Date.now() - started };
}

/** Rows from the locked attach. The shared database is not asked to run this SQL. */
export function queryConfined(dbFile: string, sql: string, options: LockedOptions = {}): Promise<RunResult> {
  const started = Date.now();
  const maxRows = options.maxRows === undefined || !Number.isFinite(options.maxRows) ? Number.MAX_SAFE_INTEGER : Math.max(0, options.maxRows);
  return withLocked(dbFile, options, sql, async (connection) => {
    const reader = maxRows === Number.MAX_SAFE_INTEGER ? await connection.runAndReadAll(sql) : await connection.runAndReadUntil(sql, Math.max(1, maxRows));
    return asResult(reader, started, maxRows);
  });
}

/** Runs the select on the locked attach. A file read fails here, so the shared database never sees it. */
export async function proveConfined(dbFile: string, selectBody: string, options: LockedOptions = {}): Promise<void> {
  await queryConfined(dbFile, `CREATE TEMP TABLE omb_check AS ${selectBody}`, { ...options, maxRows: 1 });
}
