import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { NAMED_CONNECTION_SENTENCE, containsRawDsn, dataGrantWidens, parseDataGrants } from "../../shared/data-connections.ts";
import { ConnectionStore, type ConnectionVault } from "./connections.ts";

const dirs: string[] = [];
function freshDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omb-data-connections-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function vault(saved: Map<string, string> = new Map()): ConnectionVault & { saved: Map<string, string>; bots: Map<string, "all" | string[]> } {
  let n = 0;
  const bots = new Map<string, "all" | string[]>();
  return {
    saved,
    bots,
    saveSecret(input) {
      const id = `sec-${++n}`;
      saved.set(id, input.value);
      bots.set(id, input.bots);
      return { id };
    },
    secret(id) {
      const value = saved.get(id);
      return value === undefined ? null : { value };
    },
    removeSecret(id) {
      return saved.delete(id);
    },
  };
}

describe("connection storage", () => {
  it("stores a postgres URL only in the vault and writes the file mode 0600", async () => {
    const dir = freshDir();
    const secrets = vault();
    const store = new ConnectionStore(dir, secrets);
    const secret = "postgres://bob:hunter2@127.0.0.1:1/shop";
    const added = store.add({ name: "shop", type: "postgres", dsn: secret });
    expect(added).toEqual({ name: "shop", type: "postgres", readOnly: true, where: "vault" });
    expect(secrets.bots.get("sec-1")).toEqual([]);
    expect(secrets.saved.get("sec-1")).toBe(secret);
    const file = join(dir, "data-connections.json");
    if (process.platform !== "win32") expect(lstatSync(file).mode & 0o777).toBe(0o600);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("vault:sec-1");
    expect(text).not.toContain("hunter2");
    expect(JSON.stringify(store.list())).not.toContain("hunter2");
    const probed = await store.test("shop");
    expect(probed.ok).toBe(false);
    if (!probed.ok) expect(probed.error).not.toContain("hunter2");
    chmodSync(file, 0o644);
    store.list();
    if (process.platform !== "win32") expect(lstatSync(file).mode & 0o777).toBe(0o600);
    store.remove("shop");
    expect(secrets.saved.has("sec-1")).toBe(false);
    expect(store.list().connections).toEqual([]);
  });

  it("refuses a second name, a bad name, and a postgres value that is not a URL, without echoing it", () => {
    const dir = freshDir();
    const store = new ConnectionStore(dir, vault());
    store.add({ name: "shop", type: "postgres", dsn: "postgresql://bob:hunter2@db/shop" });
    expect(() => store.add({ name: "shop", type: "postgres", dsn: "postgres://other:pw@db/x" })).toThrow(/already exists/);
    expect(() => store.add({ name: "Shop", type: "postgres", dsn: "postgres://a:b@h/db" })).toThrow(/lowercase/);
    const keyword = "host=db password=hunter2";
    expect(() => store.add({ name: "other", type: "postgres", dsn: keyword })).toThrow(/postgres:\/\//);
    expect(() => store.add({ name: "other", type: "postgres", dsn: keyword })).not.toThrow(/hunter2/);
  });

  it("keeps sqlite and duckdb files inside an allowed folder, including through a symlink", async () => {
    const root = freshDir();
    const dir = join(root, "data");
    const allowed = join(root, "allowed");
    const outside = join(root, "outside");
    mkdirSync(dir);
    mkdirSync(allowed);
    mkdirSync(outside);
    const inside = join(allowed, "shop.sqlite");
    const hidden = join(outside, "hidden.sqlite");
    const duck = join(allowed, "notes.duckdb");
    writeFileSync(inside, "");
    writeFileSync(hidden, "");
    writeFileSync(duck, "");
    const db = new DatabaseSync(inside);
    db.exec("CREATE TABLE orders (id INTEGER); INSERT INTO orders VALUES (1)");
    db.close();
    symlinkSync(hidden, join(allowed, "escape.sqlite"));
    const store = new ConnectionStore(dir, vault());
    expect(() => store.addFolder(dir)).toThrow(/data folder/);
    expect(() => store.add({ name: "main", type: "sqlite", path: inside })).toThrow(/reserved/);
    expect(() => store.add({ name: "shop", type: "sqlite", path: inside })).toThrow(/folder/);
    store.addFolder(allowed);
    const added = store.add({ name: "shop", type: "sqlite", path: inside });
    expect(added.where).toBe(realpathSync(inside));
    expect(store.add({ name: "notes", type: "duckdb", path: duck }).where).toBe(realpathSync(duck));
    expect(() => store.add({ name: "gone", type: "sqlite", path: hidden })).toThrow(/folder/);
    expect(() => store.add({ name: "escape", type: "sqlite", path: join(allowed, "escape.sqlite") })).toThrow(/folder/);
    expect(JSON.stringify(store.list())).not.toContain("password");
    expect(await store.test("shop")).toEqual({ ok: true });
    expect((await store.test("notes")).ok).toBe(false);
    expect(() => store.removeFolder(allowed)).toThrow(/Remove the connections/);
    store.remove("shop");
    store.remove("notes");
    store.removeFolder(allowed);
    expect(store.list().folders).toEqual([]);
  });

  it("replaces a corrupt file's contents with a fixed sentence", () => {
    const dir = freshDir();
    writeFileSync(join(dir, "data-connections.json"), '{ "dsn": "postgres://bob:hunter2@db/shop"');
    const store = new ConnectionStore(dir, vault());
    expect(() => store.list()).toThrow("data-connections.json could not be read.");
    try { store.list(); } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain("hunter2");
    }
  });

  it("does not treat a column named password as a connection string", () => {
    expect(containsRawDsn("SELECT password FROM users")).toBe(false);
    expect(containsRawDsn("postgres://bob:hunter2@db/shop")).toBe(true);
    expect(containsRawDsn("mariadb://bob:hunter2@db/shop")).toBe(true);
    expect(containsRawDsn("hostaddr=127.0.0.1 dbname=shop password=hunter2")).toBe(true);
    expect(containsRawDsn("Driver=SQLite3")).toBe(true);
    expect(containsRawDsn("${DATABASE_URL}")).toBe(true);
    expect(containsRawDsn("https://bob:hunter2@api.example.com/data.csv")).toBe(true);
    expect(containsRawDsn("postgresql+psycopg2://bob:hunter2@db/shop")).toBe(true);
    expect(containsRawDsn("echo $PATH")).toBe(false);
    expect(NAMED_CONNECTION_SENTENCE).not.toMatch(/postgres:\/\//);
  });
});

describe("grants", () => {
  it("parses a grant and treats a wider file as more access", () => {
    expect(parseDataGrants({ shop: { tables: ["orders"] } })).toEqual({ ok: true, grants: { shop: { tables: ["orders"] } } });
    expect(parseDataGrants({ shop: { tables: ["orders"], write: "ask" } })).toEqual({ ok: false, error: "writes come in a later update" });
    expect(parseDataGrants({ shop: { password: "x" } }).ok).toBe(false);
    expect(parseDataGrants({ main: {} })).toMatchObject({ ok: false, error: expect.stringMatching(/reserved/) });
    expect(dataGrantWidens({}, { shop: {} })).toBe(true);
    expect(dataGrantWidens({ shop: { tables: ["orders"] } }, { shop: { tables: ["orders"] } })).toBe(false);
    expect(dataGrantWidens({ shop: { tables: ["orders"] } }, { shop: {} })).toBe(true);
    expect(dataGrantWidens({ shop: { tables: ["orders"] } }, {})).toBe(false);
  });

  it("rejects home and system roots, and removes a folder that is already gone", () => {
    const root = freshDir();
    const dir = join(root, "data");
    const allowed = join(root, "kept");
    mkdirSync(dir);
    mkdirSync(allowed);
    const store = new ConnectionStore(dir, vault());
    if (process.platform === "win32") {
      expect(() => store.addFolder(`${root.slice(0, 2)}\\`)).toThrow(/data folder|too broad/);
      expect(() => store.addFolder(process.env.SystemRoot ?? "C:\\Windows")).toThrow(/too broad/);
    } else {
      expect(() => store.addFolder("/")).toThrow(/data folder/);
      expect(() => store.addFolder("/usr")).toThrow(/too broad/);
    }
    expect(() => store.addFolder(homedir())).toThrow(/too broad/);
    store.addFolder(allowed);
    rmSync(allowed, { recursive: true });
    store.removeFolder(allowed);
    expect(store.list().folders).toEqual([]);
  });

  it("rejects /tmp, the temp directory, its parent, and a temp path that covers a system root", () => {
    if (process.platform === "win32") {
      const store = new ConnectionStore(freshDir(), vault());
      expect(() => store.addFolder(tmpdir())).toThrow(/too broad|data folder/);
      expect(() => store.addFolder(dirname(tmpdir()))).toThrow(/too broad|data folder/);
      return;
    }
    const outside = mkdtempSync("/var/tmp/omb-conn-outside-");
    dirs.push(outside);
    const data = join(outside, "data");
    mkdirSync(data);
    const store = new ConnectionStore(data, vault());
    const previous = process.env.TMPDIR;
    try {
      expect(() => store.addFolder("/tmp")).toThrow(/too broad|data folder/);
      const temp = mkdtempSync("/var/tmp/omb-conn-temp-");
      dirs.push(temp);
      const child = join(temp, "kept");
      mkdirSync(child);
      process.env.TMPDIR = temp;
      expect(realpathSync(tmpdir())).toBe(realpathSync(temp));
      expect(() => store.addFolder(temp)).toThrow(/too broad/);
      expect(() => store.addFolder(dirname(temp))).toThrow(/too broad|data folder/);
      expect(() => store.addFolder(child)).not.toThrow();
      for (const [env, folder] of [["/", "/var/log"], ["/var", "/var/log"], ["/etc", "/etc/ssl"]] as const) {
        process.env.TMPDIR = env;
        expect(() => store.addFolder(folder), env).toThrow(/too broad/);
      }
    } finally {
      if (previous === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = previous;
    }
  });
});
