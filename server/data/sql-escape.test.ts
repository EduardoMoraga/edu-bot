import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";

import { flushDecisionLog } from "../decision-log.ts";
import { ConnectionStore } from "./connections.ts";
import { createDataEngine } from "./engine.ts";
import { DataSheetStore } from "./sheet.ts";
import { runDataTool, type DataContext } from "./tools.ts";
import { DataFailure } from "./types.ts";

const root = mkdtempSync(join(tmpdir(), "omb-sql-escape-"));
const dataDir = join(root, "data");
const work = join(dataDir, "workspaces", "bot-1");
const outside = join(root, "outside");
const shopDir = join(root, "shop");
const secretFile = join(dataDir, "secret.txt");
const outsideCsv = join(outside, "payroll.csv");
const shopFile = join(shopDir, "shop.sqlite");
const SECRETS = ["TOP_SECRET_VALUE", "DUCK_SECRET", "hidden", "hunter2"];

const engine = createDataEngine({
  dataDir,
  botFolder: (id) => join(dataDir, "bots", id),
  idleMs: 60_000,
});

afterAll(async () => {
  await engine.closeAll();
  rmSync(root, { recursive: true, force: true });
});

function context(): DataContext {
  return {
    database: undefined as never,
    sheet: new DataSheetStore({ botId: "bot-1", dir: join(dataDir, "sheet") }),
    compileChart: () => { throw new DataFailure({ code: "invalid_input", message: "no chart" }); },
    validateVegaLite: async () => { throw new DataFailure({ code: "invalid_input", message: "no chart" }); },
    renderer: { svg: async () => "", png: async () => Buffer.from("") },
    exportRoots: () => [work],
    signal: new AbortController().signal,
    connection: "bot",
    by: "bot",
    workFolder: work,
    dataDir,
  };
}

describe("escape attempts against real SQLite and DuckDB", () => {
  it("refuses the corpus and still loads a file from the working folder afterwards", async () => {
    mkdirSync(work, { recursive: true });
    mkdirSync(outside, { recursive: true });
    mkdirSync(shopDir, { recursive: true });
    writeFileSync(secretFile, "DUCK_SECRET\n");
    writeFileSync(outsideCsv, "note\nTOP_SECRET_VALUE\n");
    writeFileSync(join(work, "sales.csv"), "region,amount\nnorth,42\n");
    writeFileSync(join(work, "more.csv"), "region,amount\nsouth,7\n");
    symlinkSync(secretFile, join(work, "linked.txt"));
    const db = new DatabaseSync(shopFile);
    db.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, amount INTEGER); INSERT INTO orders VALUES (1, 42); CREATE TABLE secrets (note TEXT); INSERT INTO secrets VALUES ('hidden'), ('TOP_SECRET_VALUE');");
    db.close();
    const store = new ConnectionStore(dataDir, { secret: () => ({ value: "postgres://bob:hunter2@db/shop" }) });
    store.addFolder(shopDir);
    store.add({ name: "shop", type: "sqlite", path: shopFile });

    const database = await engine.forBot("bot-1");
    const ctx = { ...context(), database };
    ctx.named = {
      botId: "bot-1",
      threadId: "thread-1",
      dataDir,
      allowlist: () => ({ shop: { tables: ["orders"] } }),
      secret: () => "postgres://bob:hunter2@db/shop",
    };

    const loaded = await runDataTool(ctx, "data_load", { source: join(work, "sales.csv"), name: "sales" });
    expect(loaded.isError, JSON.stringify(loaded.structuredContent)).toBeUndefined();
    const read = await runDataTool(ctx, "data_sql", { sql: "SELECT amount FROM sales" });
    expect(read.structuredContent).toMatchObject({ rows: [["42"]] });

    const named = await runDataTool(ctx, "data_sql", { on: "shop", sql: "SELECT amount FROM orders" });
    expect(named.isError, JSON.stringify(named.structuredContent)).toBeUndefined();
    expect(named.structuredContent).toMatchObject({ rows: [["42"]] });
    await flushDecisionLog(dataDir);

    const escapes = [
      "SELECT note FROM secrets",
      `SELECT (')' || (SELECT note FROM secrets LIMIT 1) || '(') FROM orders`,
      "SELECT s.note FROM orders AS o(id, amount), secrets s",
      "WITH s AS (SELECT note FROM secrets) SELECT * FROM s",
      "WITH RECURSIVE secrets AS (SELECT note FROM secrets UNION ALL SELECT note FROM secrets WHERE false) SELECT * FROM secrets",
      "SHOW TABLES",
      "DESCRIBE orders",
      "SUMMARIZE orders",
      "SELECT * FROM read_csv('payroll.csv')",
      "SELECT * FROM read_text('secret.txt')",
      `SELECT * FROM sqlite_scan('${outsideCsv.replaceAll("'", "''")}', 'secrets')`,
      "SELECT * FROM query('SELECT note FROM secrets')",
      "SELECT * FROM sniff_csv('payroll.csv')",
      "SELECT * FROM information_schema.tables",
      "SELECT * FROM sqlite_master",
      "SELECT * FROM duckdb_tables()",
      "SELECT * FROM duckdb_databases()",
      "SELECT * FROM duckdb_settings()",
      "INSERT INTO orders VALUES (9, 9)",
      "UPDATE orders SET amount = 0",
      "DELETE FROM orders",
      "SET enable_external_access = true",
      "COPY orders TO 'out.csv'",
      "ATTACH 'other.sqlite' AS other",
      "PRAGMA database_list",
      "SELECT * FROM postgres_query('db', 'select 1')",
      "SELECT * FROM sqlite_query('db', 'select 1')",
      "PIVOT orders ON amount USING count(id)",
      `SELECT '${"postgres://bob:hunter2@db/shop"}'`,
    ];
    const readsOfOrders = [
      "UNPIVOT orders ON amount INTO NAME col VALUE val",
    ];
    for (const sql of escapes) {
      const result = await runDataTool(ctx, "data_sql", { on: "shop", sql });
      expect(result.isError, sql).toBe(true);
      const text = JSON.stringify(result);
      for (const secret of SECRETS) expect(text, sql).not.toContain(secret);
    }
    for (const sql of readsOfOrders) {
      const result = await runDataTool(ctx, "data_sql", { on: "shop", sql });
      const text = JSON.stringify(result);
      for (const secret of SECRETS) expect(text, sql).not.toContain(secret);
    }

    const secretSql = secretFile.replaceAll("'", "''");
    const local = [
      `SELECT * FROM read_text('${secretSql}')`,
      `SELECT content FROM read_text('${secretSql}')`,
      `SELECT * FROM query('SELECT content FROM read_text(''${secretSql}'')')`,
      `CREATE TABLE stolen AS SELECT * FROM read_csv('${outsideCsv.replaceAll("'", "''")}')`,
      `SELECT * FROM read_csv('${outsideCsv.replaceAll("'", "''")}')`,
    ];
    for (const sql of local) {
      const result = await runDataTool(ctx, "data_sql", { sql });
      expect(result.isError, sql).toBe(true);
      const text = JSON.stringify(result);
      for (const secret of SECRETS) expect(text, sql).not.toContain(secret);
    }

    const fromData = await runDataTool({ ...ctx, workFolder: dataDir }, "data_load", { source: secretFile });
    expect(JSON.stringify(fromData.structuredContent)).toContain("Edu Bot's data folder is not a place to load files from.");
    const fromOutside = await runDataTool(ctx, "data_load", { source: outsideCsv });
    expect(JSON.stringify(fromOutside.structuredContent)).toContain("Load files from this bot's working folder.");
    const fromLink = await runDataTool(ctx, "data_load", { source: join(work, "linked.txt") });
    expect(JSON.stringify(fromLink.structuredContent)).toContain("Load files from this bot's working folder.");
    for (const result of [fromData, fromOutside, fromLink]) {
      for (const secret of SECRETS) expect(JSON.stringify(result)).not.toContain(secret);
    }

    const again = await runDataTool(ctx, "data_load", { source: join(work, "more.csv"), name: "more" });
    expect(again.isError, JSON.stringify(again.structuredContent)).toBeUndefined();
    expect(again.structuredContent).toMatchObject({ tables: [expect.objectContaining({ name: "more", rowCount: 1 })] });
    const still = await runDataTool(ctx, "data_sql", { sql: "SELECT amount FROM sales" });
    expect(still.structuredContent).toMatchObject({ rows: [["42"]] });
    const shopStill = await runDataTool(ctx, "data_sql", { on: "shop", sql: "SELECT amount FROM orders WHERE id = 1" });
    expect(shopStill.structuredContent).toMatchObject({ rows: [["42"]] });
  }, 180_000);
});
