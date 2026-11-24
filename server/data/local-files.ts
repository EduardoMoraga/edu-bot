// Security: a bot's local data tools read files with the app's own rights, so a connection's database file, a folder
// allowed for connections and the app's data folder are refused there; a named connection reads only its allowed tables.
// Every other file stays readable, as it is from the bot's terminal. Known open risk: a symbolic link to one of these
// places inside a folder loaded whole is not followed here.
import { globSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { isInside } from "../sentinel/paths.ts";
import type { ConnectionStore } from "./connections.ts";
import { inspectSql } from "./sql-shape.ts";
import { singleStatement } from "./sql-statements.ts";

/** Folders under the app's data folder that hold the person's and bots' own files, which bots load on purpose. */
const BOT_FILE_FOLDERS = ["workspaces", "task-workspaces", "attachments", "browser-uploads", "tool-results"];
const GLOB = /[*?[\]{}]/;
const REMOTE = /^[a-z][a-z0-9+.-]*:\/\//i;

export const PROTECTED_FILE_SENTENCE = "That file belongs to a data connection or to Edu Bot itself; read it through a named connection (data_sql with on) instead.";
export const UNCHECKED_FILES_SENTENCE = "Edu Bot could not check which files this statement opens. Load files with data_load first, or name each file as a plain 'path' string, and check the syntax.";

export interface ProtectedPlaces {
  files: string[];
  folders: string[];
  dataDir: string;
  botFolders: string[];
}

/** The real path, through symbolic links, of `path` or of its nearest existing parent. */
export function realPath(path: string): string {
  const missing: string[] = [];
  let current = resolve(path);
  for (;;) {
    try {
      return join(realpathSync.native(current), ...missing.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      missing.push(basename(current));
      current = parent;
    }
  }
}

/** `writable` are the folders the bot may write data to, which it may read back even inside the app's data folder. */
export function protectedPlaces(dataDir: string, connections: Pick<ConnectionStore, "list" | "fileConnections">, writable: string[] = []): ProtectedPlaces {
  const real = realPath(dataDir);
  return {
    files: connections.fileConnections().map(realPath),
    folders: connections.list().folders.map(realPath),
    dataDir: real,
    botFolders: [...BOT_FILE_FOLDERS.map((folder) => join(real, folder)), ...writable.map(realPath).filter((folder) => folder !== real && isInside(folder, real))],
  };
}

function overlaps(path: string, places: ProtectedPlaces): boolean {
  if (places.files.some((file) => isInside(file, path))) return true;
  if (places.folders.some((folder) => isInside(path, folder) || isInside(folder, path))) return true;
  if (isInside(places.dataDir, path)) return true;
  return isInside(path, places.dataDir) && !places.botFolders.some((folder) => isInside(path, folder));
}

/** Whether reading `path` (a file, a folder read whole, or a glob) could reach a protected place. Remote addresses pass. */
export function readsProtected(path: string, places: ProtectedPlaces): boolean {
  const trimmed = path.trim();
  if (REMOTE.test(trimmed) && !/^file:\/\//i.test(trimmed)) return false;
  const local = trimmed.replace(/^file:\/\//i, "");
  const expanded = local === "~" || local.startsWith("~/") ? join(homedir(), local.slice(1)) : local;
  if (overlaps(realPath(expanded), places)) return true;
  if (!GLOB.test(expanded)) return false;
  let matches: string[];
  try { matches = globSync(expanded.replace(/\\/g, "/")); } catch { return true; }
  return matches.some((match) => overlaps(realPath(match), places));
}

/** The query whose reads a statement makes: the SELECT inside CREATE … AS and EXPLAIN [ANALYZE]. */
function readingQuery(sql: string): string {
  const { tokens, end } = singleStatement(sql);
  const body = sql.slice(0, end);
  if (tokens[0]?.text === "EXPLAIN") {
    const operand = tokens[tokens[1]?.text === "ANALYZE" ? 2 : 1];
    return operand ? readingQuery(body.slice(operand.at)) : body;
  }
  if (tokens[0]?.text === "CREATE") {
    const as = tokens.find((token) => token.kind === "word" && token.text === "AS");
    return as ? readingQuery(body.slice(as.at + as.raw.length)) : body;
  }
  return body;
}

const SUBQUERY_OR_FILE = /\b(?:SELECT|FROM|VALUES|TABLE|read_\w*|\w*_scan|glob|sniff_csv|(?:parquet|iceberg|delta|sqlite)_\w*|st_read\w*)\b/i;

/** DuckDB 1.5 runs `PIVOT source ON … USING …` as several statements, so it serializes none of it: the source is read
 * as a SELECT, and the clauses after ON may hold no subquery or file function. */
function pivotSource(sql: string): string | null {
  const { tokens, end } = singleStatement(sql);
  if (tokens[0]?.text !== "PIVOT" && tokens[0]?.text !== "PIVOT_WIDER") return null;
  const on = tokens.find((token) => token.kind === "word" && token.text === "ON");
  if (!on || !tokens[1] || tokens[1] === on) return null;
  return SUBQUERY_OR_FILE.test(sql.slice(on.at, end)) ? null : `SELECT * FROM ${sql.slice(tokens[1].at, on.at)}`;
}

/** The paths a local statement reads; not ok when they cannot be told. */
export async function localReads(sql: string): Promise<{ ok: true; files: string[] } | { ok: false }> {
  let query = readingQuery(sql);
  let inspected = await inspectSql(query, "local");
  if (!inspected.ok && inspected.reason === "not-select") {
    const source = pivotSource(query);
    if (source === null) return { ok: false };
    query = source;
    inspected = await inspectSql(query, "local");
  }
  return inspected.ok ? { ok: true, files: inspected.files } : { ok: false };
}
