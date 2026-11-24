// Security: a bot's local data tools read files with the app's own rights, so a connection's database file, a folder
// allowed for connections and the app's data folder are refused there; a named connection reads only its allowed tables.
// Every other file stays readable, as it is from the bot's terminal. Known open risks: a symbolic link to one of these
// places inside a folder loaded whole is not followed here, and a folder loaded whole is searched for hard links only
// through its first FOLDER_LINK_SEARCH entries.
import { globSync, opendirSync, realpathSync, statSync, type BigIntStats } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const PROTECTED_LINK_SEARCH = 100_000;
const FOLDER_LINK_SEARCH = 10_000;

const fileId = (stat: BigIntStats): string => `${stat.dev}:${stat.ino}`;

function statOf(path: string): BigIntStats | undefined {
  try { return statSync(path, { bigint: true, throwIfNoEntry: false }); } catch { return undefined; }
}

/** Adds the files under `folder` that have a second name; false when `budget` ran out before the end. */
function collectLinkedFiles(folder: string, skip: string[], budget: { left: number }, found: Set<string>): boolean {
  const pending = [folder];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    let entries;
    try { entries = opendirSync(current); } catch { continue; }
    try {
      for (let entry = entries.readSync(); entry; entry = entries.readSync()) {
        if (budget.left-- <= 0) return false;
        const path = join(current, entry.name);
        if (entry.isDirectory()) {
          if (!skip.includes(path)) pending.push(path);
        } else if (entry.isFile()) {
          const stat = statOf(path);
          if (stat && stat.nlink > 1n) found.add(fileId(stat));
        }
      }
    } finally {
      entries.closeSync();
    }
  }
  return true;
}

const protectedLinks = new WeakMap<ProtectedPlaces, Set<string> | "unknown">();

/** The protected files a hard link could share; "unknown" when there are too many to list. */
function protectedFileIds(places: ProtectedPlaces): Set<string> | "unknown" {
  const known = protectedLinks.get(places);
  if (known) return known;
  const found = new Set<string>();
  for (const file of places.files) {
    const stat = statOf(file);
    if (stat) found.add(fileId(stat));
  }
  const budget = { left: PROTECTED_LINK_SEARCH };
  const complete = [...places.folders, places.dataDir].every((folder) => collectLinkedFiles(folder, places.botFolders, budget, found));
  const result = complete ? found : "unknown";
  protectedLinks.set(places, result);
  return result;
}

/** Whether `path`, or a file in the folder `path`, is a hard link of a protected file. */
function sharesProtectedFile(path: string, places: ProtectedPlaces): boolean {
  const stat = statOf(path);
  const candidates = new Set<string>();
  if (stat?.isFile() && stat.nlink > 1n) candidates.add(fileId(stat));
  else if (stat?.isDirectory()) collectLinkedFiles(path, [], { left: FOLDER_LINK_SEARCH }, candidates);
  if (!candidates.size) return false;
  const ids = protectedFileIds(places);
  return ids === "unknown" || [...candidates].some((id) => ids.has(id));
}

function overlaps(path: string, places: ProtectedPlaces): boolean {
  if (places.files.some((file) => isInside(file, path))) return true;
  if (places.folders.some((folder) => isInside(path, folder) || isInside(folder, path))) return true;
  if (isInside(places.dataDir, path)) return true;
  if (isInside(path, places.dataDir) && !places.botFolders.some((folder) => isInside(path, folder))) return true;
  return sharesProtectedFile(path, places);
}

const LOCAL_HOSTS = new Set(["", "localhost", "127.0.0.1", "[::1]"]);

/** The local paths a `file:` address may open: as a URL, and as DuckDB reads it, which strips the scheme and host and
 * decodes nothing. Null when it is not an address of this computer. */
function fileUrlPaths(address: string): string[] | null {
  try {
    const url = new URL(address);
    if (!LOCAL_HOSTS.has(url.hostname)) return null;
    url.hostname = "";
    return [fileURLToPath(url), address.replace(/^file:(?:\/\/[^/\\]*)?/i, "")];
  } catch {
    return null;
  }
}

function reachesProtected(local: string, places: ProtectedPlaces): boolean {
  const expanded = local === "~" || local.startsWith("~/") ? join(homedir(), local.slice(1)) : local;
  if (overlaps(realPath(expanded), places)) return true;
  if (!GLOB.test(expanded)) return false;
  let matches: string[];
  try { matches = globSync(expanded.replace(/\\/g, "/")); } catch { return true; }
  return matches.some((match) => overlaps(realPath(match), places));
}

/** Whether reading `path` (a file, a folder read whole, or a glob) could reach a protected place. Remote addresses
 * pass; a `file:` address that names another computer does not. */
export function readsProtected(path: string, places: ProtectedPlaces): boolean {
  const trimmed = path.trim();
  if (/^file:/i.test(trimmed)) {
    const paths = fileUrlPaths(trimmed);
    return paths === null || paths.some((local) => reachesProtected(local, places));
  }
  if (REMOTE.test(trimmed)) return false;
  return reachesProtected(trimmed, places);
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
