// Named connections live in data-connections.json, mode 0600. A postgres password is only a Vault id on that file.
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { writeFileAtomic } from "../atomic.ts";
import { CONNECTION_NAME, containsRawDsn } from "../../shared/data-connections.ts";

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
  saveSecret(input: { name: string; value: string; source: "settings"; bots: "all"; refOnly?: boolean }): { id: string };
  secret(id: string): { value: string } | null;
  removeSecret(id: string): boolean;
}

interface FileShape {
  folders: string[];
  connections: StoredConnection[];
}

const FILE = "data-connections.json";
const MODE = 0o600;

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

  add(input: { name: string; type: ConnectionType; dsn?: string; path?: string }): PublicConnection {
    const name = input.name.trim();
    if (!CONNECTION_NAME.test(name)) throw new Error("A connection name is lowercase letters, digits and underscores, and starts with a letter.");
    const file = this.read();
    if (file.connections.some((connection) => connection.name === name)) throw new Error(`A connection named ${name} already exists.`);
    let dsn: string;
    if (input.type === "postgres") {
      const value = input.dsn ?? "";
      if (!/^postgres(ql)?:\/\//i.test(value) || containsRawDsn(value) === false) throw new Error("A Postgres connection is a postgres:// URL. It is saved in the Vault and never shown again.");
      if (!this.vault.saveSecret) throw new Error("The Vault is not available.");
      const saved = this.vault.saveSecret({ name: `data:${name}`, value, source: "settings", bots: "all", refOnly: true });
      dsn = `vault:${saved.id}`;
    } else {
      const path = this.assertInside(input.path ?? "");
      dsn = path;
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

  test(name: string): { ok: true } | { ok: false; error: string } {
    const connection = this.get(name);
    if (!connection) return { ok: false, error: `There is no connection named ${name}.` };
    try {
      if (connection.type === "postgres") {
        this.target(connection);
        return { ok: true };
      }
      const path = this.target(connection);
      if (connection.type === "sqlite") {
        const db = new DatabaseSync(path, { readOnly: true });
        try { db.prepare("SELECT 1").get(); } finally { db.close(); }
      }
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "The connection could not be opened.";
      return { ok: false, error: containsRawDsn(message) ? "The connection could not be opened." : message };
    }
  }

  addFolder(path: string): string {
    const folder = this.directory(path);
    const file = this.read();
    if (file.folders.includes(folder)) return folder;
    this.write({ ...file, folders: [...file.folders, folder] });
    return folder;
  }

  removeFolder(path: string): void {
    const folder = this.directory(path);
    const file = this.read();
    if (file.connections.some((connection) => connection.type !== "postgres" && this.inside(connection.dsn, folder))) {
      throw new Error("Remove the connections in that folder first.");
    }
    this.write({ ...file, folders: file.folders.filter((item) => item !== folder) });
  }

  private directory(path: string): string {
    const full = resolve(path.startsWith("~/") ? join(process.env.HOME ?? "", path.slice(2)) : path);
    let stat;
    try { stat = lstatSync(full); } catch { throw new Error("That folder does not exist."); }
    if (!stat.isDirectory() && !stat.isSymbolicLink()) throw new Error("That path is not a folder.");
    const real = realpathSync(full);
    if (!statSync(real).isDirectory()) throw new Error("That path is not a folder.");
    return real;
  }

  private assertInside(path: string): string {
    if (!path.trim()) throw new Error("A file path is required.");
    const full = resolve(path.startsWith("~/") ? join(process.env.HOME ?? "", path.slice(2)) : path);
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
    const rel = relative(root, target);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
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

function isStored(value: unknown): value is StoredConnection {
  if (!value || typeof value !== "object") return false;
  const body = value as StoredConnection;
  return CONNECTION_NAME.test(body.name) && (body.type === "postgres" || body.type === "sqlite" || body.type === "duckdb") && typeof body.dsn === "string" && body.readOnly === true;
}
