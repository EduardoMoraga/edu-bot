// Named connections live in data-connections.json, mode 0600. A postgres password is only a Vault id on that file.
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { writeFileAtomic } from "../atomic.ts";
import { resolveThroughLinks } from "../sentinel/paths.ts";
import { CONNECTION_NAME, connectionNameError, containsRawDsn } from "../../shared/data-connections.ts";
import { probeConnection } from "./session.ts";

export type ConnectionType = "postgres" | "sqlite" | "duckdb";

export interface StoredConnection {
  name: string;
  type: ConnectionType;
  /** `vault:<id>` for postgres. An absolute path inside an allowed folder for sqlite and duckdb. */
  dsn: string;
  readOnly: true;
}

export interface PublicConnection {
  name: string;
  type: ConnectionType;
  readOnly: true;
  /** `vault` for postgres. The file path for sqlite and duckdb. Never a connection string. */
  where: "vault" | string;
}

export interface ConnectionVault {
  saveSecret(input: { name: string; value: string; source: "settings"; bots: "all" | string[]; refOnly?: boolean }): { id: string };
  secret(id: string): { value: string } | null;
  removeSecret(id: string): boolean;
  updateSecret?(id: string, patch: { bots: "all" | string[] }): unknown;
}

interface FileShape {
  folders: string[];
  connections: StoredConnection[];
}

const FILE = "data-connections.json";
const MODE = 0o600;
const EXACT_ROOTS = new Set(["/", "/tmp", "/var", "/var/tmp", "/home", "/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64", "/proc", "/sys", "/dev", "/boot", "/root", "/run", "/opt", "/private", "/system", "/library"]);
const CHILD_ROOTS = ["/var", "/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64", "/proc", "/sys", "/dev", "/boot", "/root", "/run", "/opt", "/private", "/system", "/library"];

export class ConnectionStore {
  private readonly dataDir: string;
  private readonly vault: Pick<ConnectionVault, "secret"> & Partial<ConnectionVault>;
  constructor(dataDir: string, vault: Pick<ConnectionVault, "secret"> & Partial<ConnectionVault>) {
    this.dataDir = dataDir;
    this.vault = vault;
  }

  list(): { connections: PublicConnection[]; folders: string[] } {
    const file = this.read();
    return {
      folders: file.folders,
      connections: file.connections.map((connection) => ({
        name: connection.name,
        type: connection.type,
        readOnly: true,
        where: connection.type === "postgres" ? "vault" : connection.dsn,
      })),
    };
  }

  get(name: string): StoredConnection | undefined {
    if (!CONNECTION_NAME.test(name)) return undefined;
    return this.read().connections.find((connection) => connection.name === name);
  }

  vaultConnections(): Array<{ id: string; name: string }> {
    return this.read().connections.flatMap((connection) => connection.dsn.startsWith("vault:")
      ? [{ id: connection.dsn.slice("vault:".length), name: connection.name }]
      : []);
  }

  /** The attach target. Postgres reads the Vault. A file must sit strictly inside an allowed folder. */
  target(connection: StoredConnection): string {
    if (connection.type === "postgres") {
      const id = connection.dsn.startsWith("vault:") ? connection.dsn.slice("vault:".length) : "";
      const secret = id ? this.vault.secret(id) : null;
      const value = secret?.value ?? "";
      if (!/^postgres(ql)?:\/\//i.test(value)) throw new Error("That connection's password is no longer in the Vault.");
      return value;
    }
    this.assertInside(connection.dsn);
    return connection.dsn;
  }

  allowedFile(path: string): string {
    return this.assertInside(path);
  }

  connectionAt(real: string): StoredConnection | undefined {
    let wanted: string;
    try { wanted = realpathSync(real); } catch { return undefined; }
    return this.read().connections.find((connection) => {
      if (connection.type === "postgres") return false;
      try { return realpathSync(connection.dsn) === wanted; } catch { return false; }
    });
  }

  add(input: { name: string; type: ConnectionType; dsn?: string; path?: string }): PublicConnection {
    const name = input.name.trim();
    const nameError = connectionNameError(name);
    if (nameError) throw new Error(nameError);
    const file = this.read();
    if (file.connections.some((connection) => connection.name === name)) throw new Error(`A connection named ${name} already exists.`);
    let dsn: string;
    if (input.type === "postgres") {
      const value = input.dsn ?? "";
      if (!/^postgres(ql)?:\/\//i.test(value) || containsRawDsn(value) === false) throw new Error("A Postgres connection is a postgres:// URL. It is saved in the Vault and never shown again.");
      if (!this.vault.saveSecret) throw new Error("The Vault is not available.");
      const saved = this.vault.saveSecret({ name: `data:${name}`, value, source: "settings", bots: [], refOnly: true });
      dsn = `vault:${saved.id}`;
    } else {
      dsn = this.assertInside(input.path ?? "");
    }
    const connection: StoredConnection = { name, type: input.type, dsn, readOnly: true };
    this.write({ ...file, connections: [...file.connections, connection] });
    return { name, type: input.type, readOnly: true, where: input.type === "postgres" ? "vault" : dsn };
  }

  remove(name: string): void {
    const file = this.read();
    const connection = file.connections.find((item) => item.name === name);
    if (!connection) throw new Error(`There is no connection named ${name}.`);
    if (connection.dsn.startsWith("vault:") && this.vault.removeSecret) this.vault.removeSecret(connection.dsn.slice("vault:".length));
    this.write({ ...file, connections: file.connections.filter((item) => item.name !== name) });
  }

  async test(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const connection = this.get(name);
    if (!connection) return { ok: false, error: `There is no connection named ${name}.` };
    try {
      const target = this.target(connection);
      if (connection.type === "sqlite") {
        const db = new DatabaseSync(target, { readOnly: true });
        try { db.prepare("SELECT 1").get(); } finally { db.close(); }
        return { ok: true };
      }
      return await probeConnection({ dataDir: this.dataDir, type: connection.type, alias: connection.name, target });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The connection could not be opened.";
      return { ok: false, error: containsRawDsn(message) ? "The connection could not be opened." : message };
    }
  }

  addFolder(path: string): string {
    const folder = this.directory(path);
    const rejected = folderRejected(folder, this.dataDir);
    if (rejected) throw new Error(rejected);
    const file = this.read();
    if (file.folders.includes(folder)) return folder;
    this.write({ ...file, folders: [...file.folders, folder] });
    return folder;
  }

  removeFolder(path: string): void {
    const file = this.read();
    const folder = this.knownFolder(path, file.folders);
    if (file.connections.some((connection) => connection.type !== "postgres" && this.inside(connection.dsn, folder))) {
      throw new Error("Remove the connections in that folder first.");
    }
    this.write({ ...file, folders: file.folders.filter((item) => item !== folder) });
  }

  private knownFolder(path: string, folders: string[]): string {
    const expanded = this.expand(path);
    // macOS realpath maps `/var` to `/private/var`, including a leaf that is already gone.
    const wanted = resolveThroughLinks(expanded);
    const saved = folders.find((item) => item === expanded || item === path || item === resolve(path) || resolveThroughLinks(item) === wanted);
    if (saved) {
      try { return this.directory(saved); } catch { return saved; }
    }
    return this.directory(path);
  }

  private directory(path: string): string {
    const full = this.expand(path);
    let stat;
    try { stat = lstatSync(full); } catch { throw new Error("That folder does not exist."); }
    if (!stat.isDirectory() && !stat.isSymbolicLink()) throw new Error("That path is not a folder.");
    const real = realpathSync(full);
    if (!statSync(real).isDirectory()) throw new Error("That path is not a folder.");
    return real;
  }

  private expand(path: string): string {
    return resolve(path.startsWith("~/") ? join(process.env.HOME ?? "", path.slice(2)) : path);
  }

  private assertInside(path: string): string {
    if (!path.trim()) throw new Error("A file path is required.");
    const full = this.expand(path);
    let real: string;
    try { real = realpathSync(full); } catch { throw new Error("That file does not exist."); }
    if (!statSync(real).isFile()) throw new Error("That path is not a file.");
    const folders = this.read().folders;
    if (!folders.some((folder) => this.inside(real, folder))) throw new Error("Allow the folder that contains this file first.");
    return real;
  }

  /** Security: both sides are realpath'd, so a symlink cannot point a file out of an allowed folder. */
  private inside(file: string, folder: string): boolean {
    let root: string;
    let target: string;
    try {
      root = realpathSync(folder);
      target = realpathSync(file);
    } catch {
      return false;
    }
    return isInside(root, target);
  }

  private path(): string {
    return join(this.dataDir, FILE);
  }

  private read(): FileShape {
    const path = this.path();
    if (!existsSync(path)) return { folders: [], connections: [] };
    const mode = statSync(path).mode & 0o777;
    if (mode !== MODE) chmodSync(path, MODE);
    let parsed: unknown;
    try { parsed = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("data-connections.json could not be read."); }
    const body = parsed && typeof parsed === "object" ? parsed as Partial<FileShape> : {};
    const folders = Array.isArray(body.folders) ? body.folders.filter((item) => typeof item === "string") : [];
    const connections = Array.isArray(body.connections) ? body.connections.filter(isStored) : [];
    return { folders, connections };
  }

  private write(file: FileShape): void {
    mkdirSync(this.dataDir, { recursive: true });
    const path = this.path();
    writeFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`, { mode: MODE });
    chmodSync(path, MODE);
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function realOr(path: string): string {
  try { return realpathSync(path); } catch { return resolve(path); }
}

const WINDOWS_SYSTEM_FOLDERS = ["SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"];

function windowsTooBroad(real: string): boolean {
  if (process.platform !== "win32") return false;
  const path = real.toLowerCase().replace(/[\\/]+$/, "");
  if (/^[a-z]:$/.test(path) || /^[a-z]:\\users$/.test(path)) return true;
  return WINDOWS_SYSTEM_FOLDERS.some((name) => {
    const folder = process.env[name]?.toLowerCase().replace(/[\\/]+$/, "");
    return Boolean(folder) && (path === folder || path.startsWith(`${folder}\\`));
  });
}

/** A temp directory that is a system root, or that contains one, must not open that root. macOS `realpath("/tmp")` is `/private/tmp`, and `os.tmpdir()` is `/var/folders/.../T` under `/private/var`. */
function tempRootTrusted(root: string): boolean {
  if (EXACT_ROOTS.has(root)) return false;
  for (const child of CHILD_ROOTS) {
    const canonical = realOr(child);
    if (root === child || root === canonical || isInside(root, child) || isInside(root, canonical)) return false;
  }
  return true;
}

function underTemp(real: string): boolean {
  const roots = [realOr("/tmp"), realOr("/var/tmp")];
  const own = realOr(tmpdir());
  if (tempRootTrusted(own)) roots.push(own);
  return roots.some((root) => isInside(root, real));
}

function folderRejected(real: string, dataDir: string): string | null {
  const data = realOr(dataDir);
  if (real === data || isInside(data, real) || isInside(real, data)) return "Edu Bot's data folder cannot hold a database connection.";
  const home = realOr(homedir());
  if (real === home || isInside(real, home)) return "That folder is too broad.";
  if (EXACT_ROOTS.has(real) || windowsTooBroad(real)) return "That folder is too broad.";
  const own = realOr(tmpdir());
  if (real === own || real === dirname(own)) return "That folder is too broad.";
  if (underTemp(real)) return null;
  for (const root of CHILD_ROOTS) {
    const canonical = realOr(root);
    if (real === root || real === canonical || isInside(root, real) || isInside(canonical, real)) return "That folder is too broad.";
  }
  return null;
}

function isStored(value: unknown): value is StoredConnection {
  if (!value || typeof value !== "object") return false;
  const body = value as StoredConnection;
  return CONNECTION_NAME.test(body.name) && (body.type === "postgres" || body.type === "sqlite" || body.type === "duckdb") && typeof body.dsn === "string" && body.readOnly === true;
}
