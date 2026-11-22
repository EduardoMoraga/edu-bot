// DuckDB's own parser (json_serialize_sql) names every base table, table function and statement.
// A name this walk cannot place, or a statement it cannot serialize, is refused rather than run.
import type * as DuckDB from "@duckdb/node-api";

import { nativeRequire } from "./engine.ts";

type Binding = typeof DuckDB;

function duckdb(): Binding {
  return nativeRequire()("@duckdb/node-api") as Binding;
}

export interface SqlTable {
  catalog: string;
  schema: string;
  table: string;
}

export type SqlInspection =
  | { ok: true; kind: "select"; tables: SqlTable[] }
  | { ok: false; reason: "not-select" | "unsafe" | "unparsed" };

const IDENTIFIER = /^[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*$/;
const FILE_FUNCTIONS = new Set([
  "read_csv", "read_csv_auto", "read_parquet", "read_json", "read_json_auto", "read_json_objects",
  "read_ndjson", "read_ndjson_auto", "read_text", "read_blob", "glob", "sqlite_scan", "postgres_scan",
  "mysql_scan", "iceberg_scan", "delta_scan", "parquet_scan", "csv_scan", "json_scan", "getenv", "current_setting",
]);

export function isPathTable(name: string): boolean {
  return !IDENTIFIER.test(name);
}

function fileFunction(name: string): boolean {
  const folded = name.toLowerCase();
  return FILE_FUNCTIONS.has(folded) || folded.endsWith("_scan") || folded === "getenv" || folded === "current_setting";
}

interface WalkState {
  mode: "named" | "local";
  tables: SqlTable[];
  unsafe: boolean;
}

let tail: Promise<void> = Promise.resolve();
let parser: DuckDB.DuckDBConnection | null = null;

function queued<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.then(work, work);
  tail = run.then(() => undefined, () => undefined);
  return run;
}

async function parserConnection(): Promise<DuckDB.DuckDBConnection> {
  if (parser) return parser;
  const instance = await duckdb().DuckDBInstance.create(":memory:", {
    autoinstall_known_extensions: "false",
    autoload_known_extensions: "false",
    enable_external_access: "false",
  });
  parser = await instance.connect();
  return parser;
}

export function inspectSql(sql: string, mode: "named" | "local"): Promise<SqlInspection> {
  return queued(() => inspectUnlocked(sql, mode));
}

async function inspectUnlocked(sql: string, mode: "named" | "local"): Promise<SqlInspection> {
  const connection = await parserConnection();
  let parsed: unknown;
  try {
    const reader = await connection.runAndReadAll("SELECT json_serialize_sql(?::VARCHAR)", [sql]);
    parsed = JSON.parse(String(reader.getRowsJson()[0]?.[0] ?? ""));
  } catch {
    return { ok: false, reason: "unparsed" };
  }
  const body = parsed && typeof parsed === "object" ? parsed as { error?: boolean; error_message?: string; statements?: unknown[] } : null;
  if (!body) return { ok: false, reason: "unparsed" };
  if (body.error) {
    const message = body.error_message ?? "";
    if (/only select statements can be serialized/i.test(message)) return { ok: false, reason: "not-select" };
    return { ok: false, reason: "unparsed" };
  }
  if (!Array.isArray(body.statements) || body.statements.length !== 1) return { ok: false, reason: "not-select" };
  const state: WalkState = { mode, tables: [], unsafe: false };
  walk(body.statements[0], new Set(), new WeakSet(), state);
  if (state.unsafe) return { ok: false, reason: "unsafe" };
  return { ok: true, kind: "select", tables: state.tables };
}

function walk(node: unknown, ctes: ReadonlySet<string>, seen: WeakSet<object>, state: WalkState): void {
  if (!node || typeof node !== "object") return;
  if (seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) walk(item, ctes, seen, state);
    return;
  }
  const record = node as Record<string, unknown>;
  if (record.type === "RECURSIVE_CTE_NODE") {
    const name = typeof record.cte_name === "string" ? record.cte_name.toLowerCase() : "";
    walk(record.left, ctes, seen, state);
    const scope = new Set(ctes);
    if (name) scope.add(name);
    for (const [key, value] of Object.entries(record)) {
      if (key === "cte_name" || key === "left") continue;
      walk(value, scope, seen, state);
    }
    return;
  }
  if (record.type === "BASE_TABLE") {
    const table = typeof record.table_name === "string" ? record.table_name : "";
    const schema = typeof record.schema_name === "string" ? record.schema_name : "";
    const catalog = typeof record.catalog_name === "string" ? record.catalog_name : "";
    if (!table) return;
    if (!catalog && !schema && ctes.has(table.toLowerCase())) return;
    if (isPathTable(table)) state.unsafe = true;
    state.tables.push({ catalog, schema, table });
    return;
  }
  if (record.type === "SHOW_REF") {
    if (state.mode === "named") state.unsafe = true;
    walk(record.query, ctes, seen, state);
    return;
  }
  if (record.type === "TABLE_FUNCTION") {
    const name = functionName(record.function);
    if (state.mode === "named" || fileFunction(name)) state.unsafe = true;
    walk(record.function, ctes, seen, state);
    return;
  }
  if (record.type === "FUNCTION" || record.class === "FUNCTION") {
    if (fileFunction(functionName(record))) state.unsafe = true;
  }
  if (record.type === "SELECT_NODE" || record.cte_map) {
    walkQuery(record, ctes, seen, state);
    return;
  }
  for (const value of Object.values(record)) walk(value, ctes, seen, state);
}

function walkQuery(node: Record<string, unknown>, ctes: ReadonlySet<string>, seen: WeakSet<object>, state: WalkState): void {
  const map = (node.cte_map as { map?: unknown } | undefined)?.map;
  const entries = Array.isArray(map) ? map : [];
  let scope = ctes;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { key?: unknown; value?: { query?: unknown } };
    walk(record.value?.query, scope, seen, state);
    const next = new Set(scope);
    if (typeof record.key === "string" && record.key) next.add(record.key.toLowerCase());
    scope = next;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "cte_map") continue;
    walk(value, scope, seen, state);
  }
}

function functionName(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const name = (node as { function_name?: unknown }).function_name;
  return typeof name === "string" ? name : "";
}
