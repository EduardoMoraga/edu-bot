// Named reads LOAD sqlite_scanner and postgres_scanner from a bundled file. Nothing installs them at runtime.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

import pinsFile from "./duckdb-extensions.json" with { type: "json" };

import { duckdbDirectory, nativeRequire } from "./engine.ts";
import { DataFailure } from "./types.ts";

interface ExtensionPins {
  library: string;
  scanners: string[];
  gzipSha256: Record<string, string>;
  fileSha256: Record<string, string>;
}

const DUCK_PLATFORM: Record<string, string> = {
  "linux-x64": "linux_amd64",
  "linux-arm64": "linux_arm64",
  "darwin-x64": "osx_amd64",
  "darwin-arm64": "osx_arm64",
  "win32-x64": "windows_amd64",
};

const pins = pinsFile as ExtensionPins;
const flights = new Map<string, Promise<string>>();

export const EXTENSION_LIBRARY = pins.library;

function duckPlatform(): string {
  const name = DUCK_PLATFORM[`${process.platform}-${process.arch}`];
  if (!name) throw new DataFailure({ code: "sql_error", message: "No bundled database extension for this computer." });
  return name;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function layout(): { root: string; packaged: boolean } {
  const staged = duckdbDirectory();
  if (staged) return { root: join(staged, "extensions"), packaged: true };
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  return { root: join(repo, "dist-native", "duckdb", `${process.platform}-${process.arch}`, "extensions"), packaged: false };
}

function filePath(name: string): string {
  return join(layout().root, pins.library, duckPlatform(), `${name}.duckdb_extension`);
}

function plainName(name: string): string {
  return name === "sqlite_scanner" ? "sqlite" : "postgres";
}

function missing(name: string): DataFailure {
  return new DataFailure({ code: "sql_error", message: `The bundled ${plainName(name)} extension is missing.` });
}

function mismatch(name: string): DataFailure {
  return new DataFailure({ code: "sql_error", message: `The bundled ${plainName(name)} extension does not match this DuckDB version.` });
}

function assertLibrary(): void {
  const found = (nativeRequire()("@duckdb/node-api") as { version(): string }).version();
  if (found !== pins.library) {
    throw new DataFailure({ code: "sql_error", message: `This DuckDB build is ${found}; the bundled extensions are for ${pins.library}.` });
  }
}

async function download(name: string, destination: string): Promise<void> {
  const platform = duckPlatform();
  const key = `${platform}/${name}`;
  const gzipHash = pins.gzipSha256[key];
  const fileHash = pins.fileSha256[key];
  if (!gzipHash || !fileHash) throw missing(name);
  const url = `https://extensions.duckdb.org/${pins.library}/${platform}/${name}.duckdb_extension.gz`;
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.url.startsWith("https://")) throw new DataFailure({ code: "sql_error", message: `The ${plainName(name)} extension could not be downloaded.`, retryable: true });
  const gzip = Buffer.from(await response.arrayBuffer());
  if (sha256(gzip) !== gzipHash) throw mismatch(name);
  const file = gunzipSync(gzip);
  if (sha256(file) !== fileHash) throw mismatch(name);
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.partial`;
  writeFileSync(temporary, file);
  renameSync(temporary, destination);
}

async function loadScanner(name: string): Promise<string> {
  assertLibrary();
  const path = filePath(name);
  const wanted = pins.fileSha256[`${duckPlatform()}/${name}`];
  let found: Buffer | null = null;
  try { found = readFileSync(path); } catch { found = null; }
  if (found && wanted && sha256(found) === wanted) return path.replaceAll("\\", "/");
  if (layout().packaged) throw found ? mismatch(name) : missing(name);
  try {
    await download(name, path);
  } catch (error) {
    if (error instanceof DataFailure) throw error;
    throw new DataFailure({ code: "sql_error", message: `The ${plainName(name)} extension could not be downloaded.`, retryable: true });
  }
  return path.replaceAll("\\", "/");
}

/** One verified path per process. A packaged tree never downloads. */
export function scannerPath(name: "sqlite_scanner" | "postgres_scanner"): Promise<string> {
  const existing = flights.get(name);
  if (existing) return existing;
  const run = loadScanner(name).catch((error) => {
    flights.delete(name);
    throw error;
  });
  flights.set(name, run);
  return run;
}
