import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";

import { ConnectionStore, type StoredConnection } from "./connections.ts";
import { createDataEngine } from "./engine.ts";
import { relationAllowed } from "./live.ts";
import { DataSheetStore } from "./sheet.ts";
import { runNamedRead } from "./session.ts";
import { loadData, type DataContext } from "./tools.ts";
import { DataFailure } from "./types.ts";

const root = mkdtempSync(join(tmpdir(), "omb-named-read-"));
const dataDir = join(root, "data");
const shopDir = join(root, "shop");
const shopFile = join(shopDir, "shop.sqlite");
const connection: StoredConnection = { name: "shop", type: "sqlite", dsn: "/tmp/shop.sqlite", readOnly: true };

const engine = createDataEngine({
  dataDir,
  botFolder: (id) => join(dataDir, "bots", id),
  idleMs: 60_000,
});

afterAll(async () => {
  await engine.closeAll();
  rmSync(root, { recursive: true, force: true });
});

function filesUnder(dir: string): string[] {
  let found: string[];
  try { found = readdirSync(dir); } catch { return []; }
  const paths: string[] = [];
  for (const name of found) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) paths.push(...filesUnder(path));
    else paths.push(path);
  }
  return paths;
}

describe("catalog names on an open grant", () => {
  const table = (name: string) => ({ catalog: "", schema: "", table: name });

  it("blocks sqlite_, duckdb_, pragma_ and pg_ unless the grant names that object", () => {
    for (const name of ["pragma_database_list", "sqlite_temp_schema", "pg_tables", "duckdb_settings"]) {
      expect(relationAllowed(table(name), {}, connection)).toBe(false);
    }
    expect(relationAllowed(table("orders"), {}, connection)).toBe(true);
    expect(relationAllowed(table("pragma_database_list"), { tables: ["pragma_database_list"] }, connection)).toBe(true);
    for (const name of ["pragma_database_list", "pg_settings", "pg_class", "sqlite_master", "sqlite_temp_schema"]) {
      expect(relationAllowed(table(name), { schemas: ["main"] }, connection), name).toBe(false);
      expect(relationAllowed({ catalog: "", schema: "main", table: name }, { schemas: ["main"] }, connection), `main.${name}`).toBe(false);
    }
    expect(relationAllowed({ catalog: "", schema: "pg_catalog", table: "pg_class" }, { schemas: ["pg_catalog"] }, connection)).toBe(true);
    expect(relationAllowed(table("orders"), { schemas: ["main"] }, connection)).toBe(true);
  });
});

describe("named reads and sqlite loads", () => {
  it("returns the real numeric and date column types", async () => {
    mkdirSync(shopDir, { recursive: true });
    const db = new DatabaseSync(shopFile);
    db.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, amount INTEGER, ordered_on TEXT); INSERT INTO orders VALUES (1, 42, '2026-01-02');");
    db.close();
    const store = new ConnectionStore(dataDir, { secret: () => null });
    store.addFolder(shopDir);
    store.add({ name: "shop", type: "sqlite", path: shopFile });
    const saved = store.get("shop");
    if (!saved) throw new Error("missing shop");
    const result = await runNamedRead({
      dataDir,
      connection: saved,
      target: store.target(saved),
      sql: "SELECT amount, CAST(ordered_on AS DATE) AS ordered_on FROM orders",
      maxRows: 5,
    });
    expect(result.rows).toEqual([["42", "2026-01-02"]]);
    expect(result.columns.map((column) => column.name)).toEqual(["amount", "ordered_on"]);
    expect(result.columns[0]?.type).toMatch(/INT/i);
    expect(result.columns[1]?.type).toMatch(/DATE/i);
    expect(result.columns.every((column) => column.type !== "VARCHAR")).toBe(true);
  });

  it("loads a sqlite file through the bundled scanner and does not install one into the data directory", async () => {
    const database = await engine.forBot("loader");
    const ctx: DataContext = {
      database,
      sheet: new DataSheetStore({ botId: "loader", dir: join(dataDir, "sheet") }),
      compileChart: () => { throw new DataFailure({ code: "invalid_input", message: "no chart" }); },
      validateVegaLite: async () => { throw new DataFailure({ code: "invalid_input", message: "no chart" }); },
      renderer: { svg: async () => "", png: async () => Buffer.from("") },
      exportRoots: () => [dataDir],
      signal: new AbortController().signal,
      connection: "bot",
      by: "bot",
    };
    const loaded = await loadData(ctx, { source: shopFile, sheet: "orders", name: "orders" });
    expect(loaded.tables[0]).toMatchObject({ name: "orders", rowCount: 1 });
    expect(filesUnder(dataDir).some((path) => path.includes("sqlite_scanner"))).toBe(false);
  });
});
