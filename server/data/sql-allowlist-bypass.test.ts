import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";

import { flushDecisionLog } from "../decision-log.ts";
import { FakeDataDatabase } from "../testing/fake-data-database.ts";
import { ConnectionStore } from "./connections.ts";
import { DataSheetStore } from "./sheet.ts";
import { runDataTool, type DataContext } from "./tools.ts";
import { DataFailure } from "./types.ts";

const root = mkdtempSync(join(tmpdir(), "omb-sql-allowlist-"));
const dataDir = join(root, "data");
const shopDir = join(root, "shop");
const shopFile = join(shopDir, "shop.sqlite");
const SECRET = "TOP_SECRET_NOTE";

afterAll(async () => {
  await flushDecisionLog(dataDir);
  rmSync(root, { recursive: true, force: true });
});

function snapshot() {
  const db = new DatabaseSync(shopFile, { readOnly: true });
  const orders = db.prepare("SELECT id, amount FROM orders ORDER BY id").all();
  const secrets = db.prepare("SELECT note FROM secrets ORDER BY note").all();
  db.close();
  return { orders, secrets };
}

function context(): DataContext {
  return {
    database: new FakeDataDatabase(),
    sheet: new DataSheetStore({ botId: "bot-1", dir: join(dataDir, "sheet") }),
    compileChart: () => { throw new DataFailure({ code: "invalid_input", message: "no chart" }); },
    validateVegaLite: async () => { throw new DataFailure({ code: "invalid_input", message: "no chart" }); },
    renderer: { svg: async () => "", png: async () => Buffer.from("") },
    exportRoots: () => [dataDir],
    signal: new AbortController().signal,
    connection: "bot",
    by: "bot",
    named: {
      botId: "bot-1",
      threadId: "thread-1",
      dataDir,
      allowlist: () => ({ shop: { tables: ["orders"] } }),
      secret: () => null,
    },
  };
}

describe("a read-only allowlisted SQL connection", () => {
  mkdirSync(shopDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(shopFile);
  db.exec("CREATE TABLE orders (id INTEGER PRIMARY KEY, amount INTEGER); INSERT INTO orders VALUES (1, 42); CREATE TABLE secrets (note TEXT); INSERT INTO secrets VALUES ('TOP_SECRET_NOTE');");
  db.close();
  const store = new ConnectionStore(dataDir, { secret: () => null });
  store.addFolder(shopDir);
  store.add({ name: "shop", type: "sqlite", path: shopFile });
  const before = snapshot();

  const query = (sql: string) => runDataTool(context(), "data_sql", { on: "shop", sql });

  it("reads an allowlisted table, including through comments and case that do not name another table", async () => {
    for (const sql of [
      "SELECT amount FROM orders WHERE id = 1",
      "SELECT amount FROM orders -- ; DROP TABLE orders; SELECT note FROM secrets",
      "SELECT amount FROM orders /* ; DROP TABLE secrets; SELECT note FROM secrets */",
      "SeLeCt amount FrOm OrDeRs WHERE id = 1",
      'SELECT amount FROM "orders" WHERE id = 1',
      "SELECT amount FROM main.orders WHERE id = 1",
    ]) {
      const result = await query(sql);
      expect(result.isError, `${sql} → ${JSON.stringify(result.structuredContent)}`).toBeUndefined();
      expect(result.structuredContent, sql).toMatchObject({ rows: [["42"]] });
      expect(JSON.stringify(result), sql).not.toContain(SECRET);
    }
  });

  it("rejects writes and DDL before they touch the database", async () => {
    const writes = [
      "INSERT INTO orders VALUES (9, 9)",
      "UPDATE orders SET amount = 0",
      "DELETE FROM orders",
      "DROP TABLE orders",
      "DROP TABLE secrets",
      "ALTER TABLE orders ADD COLUMN stolen TEXT",
      "CREATE TABLE stolen AS SELECT note FROM secrets",
      "CREATE TABLE stolen (note TEXT)",
      "TRUNCATE orders",
      "REPLACE INTO orders VALUES (1, 0)",
      "GRANT SELECT ON secrets TO PUBLIC",
      "WITH s AS (SELECT 1) DELETE FROM orders",
      "WITH s AS (SELECT note FROM secrets) INSERT INTO orders SELECT 2, 2",
    ];
    for (const sql of writes) {
      const result = await query(sql);
      expect(result.isError, sql).toBe(true);
      expect(result.structuredContent, sql).toMatchObject({ code: "write_refused" });
      expect(JSON.stringify(result), sql).not.toContain(SECRET);
    }
    expect(snapshot()).toEqual(before);
  });

  it("rejects other tables reached by joins, subqueries, comments, case, or a second statement", async () => {
    const bypasses = [
      "SELECT note FROM secrets",
      "SeLeCt NoTe FrOm SeCrEtS",
      'SELECT note FROM "secrets"',
      'SELECT note FROM "Secrets"',
      "SELECT note FROM main.secrets",
      "SELECT o.amount, s.note FROM orders o JOIN secrets s ON 1 = 1",
      "SELECT amount FROM orders, secrets",
      "SELECT amount FROM orders WHERE id IN (SELECT 1 FROM secrets)",
      "SELECT (SELECT note FROM secrets) FROM orders",
      "SELECT * FROM (SELECT note FROM secrets) AS hidden",
      "WITH s AS (SELECT note FROM secrets) SELECT * FROM s",
      "WITH RECURSIVE secrets AS (SELECT note FROM secrets UNION ALL SELECT note FROM secrets WHERE false) SELECT * FROM secrets",
      "SELECT note FROM secrets -- orders",
      "SELECT note FROM secrets /* this is orders */",
      "SELECT/**/note/**/FROM/**/secrets",
      "SELECT amount FROM orders UNION SELECT note FROM secrets",
      "SELECT amount FROM orders; SELECT note FROM secrets",
      "SELECT amount FROM orders; DROP TABLE secrets",
      "SELECT 1; CREATE TABLE pwn (note TEXT)",
      "/* allow orders */ SELECT note FROM secrets",
    ];
    for (const sql of bypasses) {
      const result = await query(sql);
      expect(result.isError, sql).toBe(true);
      expect(["write_refused", "invalid_input"]).toContain((result.structuredContent as { code?: string }).code);
      expect(JSON.stringify(result), sql).not.toContain(SECRET);
    }
    expect(snapshot()).toEqual(before);
  });
});
