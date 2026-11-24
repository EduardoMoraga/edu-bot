import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConnectionStore } from "./connections.ts";
import { chartRenderer, compileChart, validateVegaLite } from "./deps.ts";
import { createDataEngine } from "./engine.ts";
import { localReads, PROTECTED_FILE_SENTENCE, UNCHECKED_FILES_SENTENCE } from "./local-files.ts";
import { DataSheetStore } from "./sheet.ts";
import { describeTarget, exportData, loadData, runSql, showCard, type DataContext } from "./tools.ts";
import { DataFailure } from "./types.ts";

const root = mkdtempSync(join(tmpdir(), "omb-local-files-"));
const dataDir = join(root, "data");
const shop = join(root, "shop");
const shopFile = join(shop, "shop.sqlite");
const other = join(root, "other");
const engine = createDataEngine({ botFolder: (id) => join(root, "bots", id), dataDir });
const sq = (path: string) => `'${path.replace(/'/g, "''")}'`;

beforeAll(() => {
  mkdirSync(shop, { recursive: true });
  mkdirSync(other, { recursive: true });
  mkdirSync(join(dataDir, "attachments"), { recursive: true });
  const db = new DatabaseSync(shopFile);
  db.exec("CREATE TABLE sales (id INTEGER, amount INTEGER); INSERT INTO sales VALUES (1, 42); CREATE TABLE secret (id INTEGER, note TEXT); INSERT INTO secret VALUES (1, 'TOPSECRET');");
  db.close();
  writeFileSync(join(shop, "notes.csv"), "note\nTOPSECRET\n");
  writeFileSync(join(other, "ok.csv"), "product,amount\nPencil,3\n");
  writeFileSync(join(dataDir, "attachments", "sent.csv"), "product,amount\nEraser,4\n");
  symlinkSync(shopFile, join(other, "alias.sqlite"));
  const store = new ConnectionStore(dataDir, { secret: () => null });
  store.addFolder(shop);
  store.add({ name: "shop", type: "sqlite", path: shopFile });
});

afterAll(async () => {
  await engine.closeAll();
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function context(botId: string, named = true): Promise<DataContext> {
  return {
    database: await engine.forBot(botId), sheet: new DataSheetStore({ botId, dir: join(root, "sheets", botId) }),
    renderer: chartRenderer, compileChart, validateVegaLite, exportRoots: () => [root],
    signal: new AbortController().signal, connection: "bot", by: named ? "bot" : "person",
    ...(named ? { named: { botId, threadId: `t-${botId}`, dataDir, allowlist: () => undefined, secret: () => null } } : {}),
  };
}

async function refusal(work: Promise<unknown>): Promise<string> {
  const error = await work.then(() => null, (failure: unknown) => failure);
  expect(error).toBeInstanceOf(DataFailure);
  return (error as DataFailure).message;
}

describe("a bot's local data tools", () => {
  it("never load a connection's file, a file in a connection folder or the app's own files, with no grant at all", async () => {
    const ctx = await context("loader");
    for (const input of [
      { source: shopFile, sheet: "secret" },
      { source: join(other, "alias.sqlite"), sheet: "secret" },
      { source: join(shop, "notes.csv") },
      { source: `${shop}/*.csv` },
      { source: join(dataDir, "data-connections.json"), kind: "json" as const },
      { source: root, kind: "folder" as const },
    ]) expect(await refusal(loadData(ctx, input)), input.source).toBe(PROTECTED_FILE_SENTENCE);
    expect(await ctx.database.listTables()).toEqual([]);
  });

  it("never read those files through local SQL, in any statement that reads", async () => {
    const ctx = await context("sql");
    const connections = join(dataDir, "data-connections.json");
    for (const sql of [
      `SELECT * FROM sqlite_scan(${sq(shopFile)}, 'secret')`,
      `SELECT * FROM read_text(${sq(connections)})`,
      `SELECT * FROM read_text([${sq(join(other, "ok.csv"))}, ${sq(connections)}])`,
      `SELECT * FROM read_csv(path := ${sq(join(shop, "notes.csv"))})`,
      `FROM ${sq(join(shop, "notes.csv"))}`,
      `SELECT * FROM read_csv(${sq(`${root}/*/notes.csv`)})`,
      `SELECT * FROM read_blob(${sq(join(other, "alias.sqlite"))})`,
      `SELECT (SELECT count(*) FROM read_text(${sq(connections)})) AS n`,
      `WITH x AS (SELECT * FROM sqlite_scan(${sq(shopFile)}, 'secret')) SELECT * FROM x`,
      `CREATE TABLE leak AS SELECT * FROM read_text(${sq(connections)})`,
      `CREATE OR REPLACE VIEW leak AS SELECT * FROM sqlite_scan(${sq(shopFile)}, 'secret')`,
      `EXPLAIN ANALYZE SELECT * FROM read_text(${sq(connections)})`,
      `SUMMARIZE SELECT * FROM read_text(${sq(connections)})`,
      `PIVOT (SELECT * FROM sqlite_scan(${sq(shopFile)}, 'secret')) ON id USING count(*)`,
      `PIVOT ${sq(join(shop, "notes.csv"))} ON note USING count(*)`,
    ]) expect(await refusal(runSql(ctx, { sql })), sql).toBe(PROTECTED_FILE_SENTENCE);
    expect(await refusal(describeTarget(ctx, `SELECT * FROM read_text(${sq(connections)})`))).toBe(PROTECTED_FILE_SENTENCE);
    expect(await refusal(showCard(ctx, { sql: `SELECT * FROM sqlite_scan(${sq(shopFile)}, 'secret')`, kind: "table" }))).toBe(PROTECTED_FILE_SENTENCE);
    expect(await refusal(exportData(ctx, { sql: `SELECT * FROM read_text(${sq(connections)})`, format: "csv", path: join(root, "out.csv") }))).toBe(PROTECTED_FILE_SENTENCE);
    expect(await ctx.database.listTables()).toEqual([]);
  });

  it("refuse a read whose path is not a plain string, since it cannot be checked", async () => {
    const ctx = await context("computed");
    for (const sql of [
      `SELECT * FROM read_text(${sq(dataDir)} || '/data-connections.json')`,
      `SELECT * FROM read_text(lower(${sq(join(dataDir, "data-connections.json"))}))`,
      "SELECT * FROM (VALUES ('x')) t(p), LATERAL read_text(t.p)",
      `PIVOT ok ON product IN (SELECT content FROM read_text(${sq(join(dataDir, "data-connections.json"))})) USING count(*)`,
    ]) expect(await refusal(runSql(ctx, { sql })), sql).toBe(UNCHECKED_FILES_SENTENCE);
  });

  it("keep reading every other file, and the person's attachments in the app's folder", async () => {
    const ctx = await context("reader");
    expect((await loadData(ctx, { source: join(other, "ok.csv"), name: "ok" })).tables[0]).toMatchObject({ name: "ok", rowCount: 1 });
    expect((await loadData(ctx, { source: join(dataDir, "attachments", "sent.csv"), name: "sent" })).tables[0]).toMatchObject({ rowCount: 1 });
    expect((await runSql(ctx, { sql: `SELECT product FROM read_csv(${sq(join(other, "ok.csv"))})` })).rows).toEqual([["Pencil"]]);
    expect((await runSql(ctx, { sql: `SELECT count(*) FROM ${sq(`${other}/*.csv`)}` })).rows).toEqual([["1"]]);
    expect((await runSql(ctx, { sql: `CREATE TABLE copied AS SELECT * FROM read_csv(${sq(join(other, "ok.csv"))})` })).table).toBe("copied");
    for (const sql of ["SELECT 1", "SHOW TABLES", "DESCRIBE ok", "SUMMARIZE ok", "PIVOT ok ON product USING sum(amount)", "EXPLAIN SELECT * FROM ok", "VALUES (1, 2)", "FROM ok SELECT product"]) {
      await expect(runSql(ctx, { sql }), sql).resolves.toBeDefined();
    }
  });

  it("leave the person's own panel unlimited", async () => {
    const ctx = await context("panel", false);
    expect((await runSql(ctx, { sql: `SELECT note FROM read_csv(${sq(join(shop, "notes.csv"))})` })).rows).toEqual([["TOPSECRET"]]);
  });

  it("tell the files a statement reads", async () => {
    expect(await localReads("SELECT * FROM read_csv(['/a.csv', '/b.csv']) JOIN '/c.parquet' USING (id)")).toEqual({ ok: true, files: ["/a.csv", "/b.csv", "/c.parquet"] });
    expect(await localReads("CREATE TABLE t AS FROM read_json('/d.json')")).toEqual({ ok: true, files: ["/d.json"] });
    expect(await localReads("SELEC 1")).toEqual({ ok: false });
  });
});
