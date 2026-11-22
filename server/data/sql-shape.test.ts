import { describe, expect, it } from "vitest";

import { inspectSql, localSqlTouchesFiles } from "./sql-shape.ts";

const tablesOf = async (sql: string, mode: "named" | "local" = "named") => {
  const result = await inspectSql(sql, mode);
  expect(result.ok, `${sql} → ${JSON.stringify(result)}`).toBe(true);
  return result.ok ? result.tables.map((table) => [table.catalog, table.schema, table.table].filter(Boolean).join(".")) : [];
};

describe("inspectSql", () => {
  it("allows a single select, a column-list CTE, and a recursive CTE", async () => {
    expect(await inspectSql("SELECT 1", "named")).toEqual({ ok: true, kind: "select", tables: [] });
    expect(await tablesOf("WITH a(x) AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a, b")).toEqual([]);
    expect(await tablesOf("WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 3) SELECT * FROM c")).toEqual([]);
  });

  it("does not let a recursive CTE hide its anchor table, at any case", async () => {
    expect(await tablesOf("WITH RECURSIVE secrets AS (SELECT note FROM secrets UNION ALL SELECT note FROM secrets WHERE false) SELECT * FROM secrets")).toEqual(["secrets"]);
    expect(await tablesOf("WITH RECURSIVE Secrets AS (SELECT note FROM secrets UNION ALL SELECT note FROM Secrets WHERE false) SELECT * FROM Secrets")).toEqual(["secrets"]);
  });

  it("keeps an earlier CTE and still names a base table in the other branch", async () => {
    expect(await tablesOf("WITH a AS (SELECT 1) SELECT * FROM a UNION SELECT amount FROM orders")).toEqual(["orders"]);
    expect(await tablesOf("WITH A AS (SELECT 1) SELECT * FROM a UNION SELECT amount FROM Orders")).toEqual(["Orders"]);
  });

  it("names every base table a parenthesis, a comma join, or a CTE hides", async () => {
    expect(await tablesOf(`SELECT (')' || (SELECT note FROM "shop"."main"."secrets" LIMIT 1) || '(') FROM orders`)).toEqual(expect.arrayContaining(["orders", "shop.main.secrets"]));
    expect(await tablesOf(`SELECT s.note FROM orders AS o(id, amount), "shop"."main"."secrets" s`)).toEqual(expect.arrayContaining(["orders", "shop.main.secrets"]));
    expect(await tablesOf("WITH s(note) AS (SELECT note FROM secrets), t AS (SELECT 1) SELECT * FROM s, t")).toEqual(["secrets"]);
  });

  it("refuses table functions, file scans, show, path tables and a second statement on a named connection", async () => {
    const unsafe = [
      "SELECT * FROM range(3)",
      "SELECT * FROM read_csv('payroll.csv')",
      "SELECT * FROM sqlite_scan('other.sqlite', 'secrets')",
      "SELECT * FROM 'payroll.csv'",
      "SHOW TABLES",
    ];
    for (const sql of unsafe) expect(await inspectSql(sql, "named"), sql).toMatchObject({ ok: false, reason: "unsafe" });
    expect(await inspectSql("SELECT 1; SELECT 2", "named")).toMatchObject({ ok: false, reason: "not-select" });
    expect(await inspectSql("INSERT INTO orders VALUES (1, 2)", "named")).toMatchObject({ ok: false, reason: "not-select" });
    expect(await inspectSql("CREATE TABLE stolen AS SELECT * FROM read_csv('payroll.csv')", "named")).toMatchObject({ ok: false });
  });

  it("lets a local query use range and show, and still catches a file read", async () => {
    expect(await inspectSql("SELECT * FROM range(3)", "local")).toMatchObject({ ok: true });
    expect(await inspectSql("SHOW TABLES", "local")).toMatchObject({ ok: true });
    expect(await inspectSql("SELECT * FROM read_csv('payroll.csv')", "local")).toMatchObject({ ok: false, reason: "unsafe" });
    expect(await localSqlTouchesFiles("SELECT 1")).toBe(false);
    expect(await localSqlTouchesFiles("CREATE TABLE stolen AS SELECT * FROM read_csv('payroll.csv')")).toBe(true);
    expect(await localSqlTouchesFiles("SELECT * FROM sqlite_scan('other.sqlite', 'secrets')")).toBe(true);
  });
});
