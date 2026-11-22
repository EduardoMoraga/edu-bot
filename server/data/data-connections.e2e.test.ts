import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb, verificationServerEnvironment } from "../../scripts/control-omb.ts";
import { waitForExit } from "../testing/cleanup.ts";

const CAPABILITY_KEY = "data-connections-e2e-capability";

async function fixture() {
  const launched = await launchVerificationServer();
  const { dataDir, url, logPath } = launched.info;
  await waitForExit(launched.child, { signal: "SIGTERM" });
  const log = openSync(logPath, "a", 0o600);
  const server = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("../index.ts", import.meta.url))], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    env: { ...verificationServerEnvironment({}, dataDir, Number(new URL(url).port)), OMB_TEST_INTERNAL_CAPABILITY_KEY: CAPABILITY_KEY },
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  await expect.poll(async () => {
    try { return (await fetch(url + "/api/health", { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; }
  }, { timeout: 30_000 }).toBe(true);
  const api = async (method: string, path: string, body?: unknown, status = 200, headers: Record<string, string> = {}) => {
    const response = await fetch(url + path, {
      method, headers: { "content-type": "application/json", origin: url, ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(120_000),
    });
    const text = await response.text();
    expect(response.status, `${method} ${path}: ${text.slice(0, 500)}`).toBe(status);
    return text ? JSON.parse(text) as any : null;
  };
  return { dataDir, url, server, api };
}

it("answers an allowed sqlite table and refuses another", async () => {
  const { dataDir, url, server, api } = await fixture();
  const allowed = join(dirname(dataDir), `shop-${process.pid}-${Date.now()}`);
  mkdirSync(allowed);
  try {
    const { bot } = await runControlOmb(["new-bot", "--name", "Shop bot", "--url", url]) as { bot: { id: string; activeTaskId: string } };
    const threadId = bot.activeTaskId;
    const file = join(allowed, "shop.sqlite");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE orders (id INTEGER, amount INTEGER); INSERT INTO orders VALUES (1, 42); CREATE TABLE secrets (id INTEGER, note TEXT); INSERT INTO secrets VALUES (1, 'hidden');");
    db.close();
    await api("POST", "/api/data-connections/folders", { path: dataDir }, 400);
    await api("POST", "/api/data-connections/folders", { path: allowed }, 201);
    const added = await api("POST", "/api/data-connections", { name: "shop", type: "sqlite", path: file }, 201);
    expect(added.where).toBe(file);
    expect(JSON.stringify(await api("GET", "/api/data-connections"))).not.toMatch(/postgres:\/\//);
    await api("PATCH", `/api/bots/${bot.id}`, { dataConnections: { shop: { tables: ["orders"] } } });
    const minted = await api("POST", "/api/testing/internal-capability", { botId: bot.id, threadId, kind: "data" }, 201, { "x-openmausbot-test-capability": CAPABILITY_KEY });
    const call = async (name: string, args: Record<string, unknown>) => {
      const result = (await api("POST", "/api/internal/data/mcp", { method: "tools/call", params: { name, arguments: args } }, 200, { authorization: `Bearer ${minted.token}` })).result;
      return { isError: result.isError === true, data: result.structuredContent as Record<string, any>, text: result.content?.[0]?.text as string };
    };
    const leaked = await call("data_sql", { on: "shop", sql: "SELECT 'postgres://bob:hunter2@db/shop'" });
    expect(leaked.isError).toBe(true);
    expect(JSON.stringify(leaked)).not.toContain("hunter2");
    const other = await call("data_sql", { on: "shop", sql: "SELECT note FROM secrets" });
    expect(other.data.code).toBe("write_refused");
    const inserted = await call("data_sql", { on: "shop", sql: "INSERT INTO orders VALUES (9, 9)" });
    expect(inserted.data.code).toBe("write_refused");
    const read = await call("data_sql", { on: "shop", sql: "SELECT amount FROM orders" });
    if (read.isError && /extension|INSTALL|network|offline/i.test(read.text ?? "")) {
      throw new Error(`DuckDB could not load the sqlite extension offline: ${read.text}`);
    }
    expect(read.isError, read.text).toBe(false);
    expect(read.data.rows).toEqual([["42"]]);
    const month = new Date().toISOString().slice(0, 7);
    const log = readFileSync(join(dataDir, "decisions", `${month}.ndjson`), "utf8");
    expect(log).toContain('"source":"data"');
    expect(log).not.toContain("hunter2");
    expect(log).not.toContain("hidden");
  } finally {
    await waitForExit(server, { signal: "SIGTERM" });
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(allowed, { recursive: true, force: true });
  }
}, 180_000);

it.skipIf(!process.env.EDUBOT_PG_TEST_URL)("reads postgres when EDUBOT_PG_TEST_URL is set", async () => {
  const dsn = process.env.EDUBOT_PG_TEST_URL!;
  const { dataDir, url, server, api } = await fixture();
  try {
    const { bot } = await runControlOmb(["new-bot", "--name", "Pg bot", "--url", url]) as { bot: { id: string; activeTaskId: string } };
    await api("POST", "/api/data-connections", { name: "pg", type: "postgres", dsn }, 201);
    expect(JSON.stringify(await api("GET", "/api/data-connections"))).not.toContain(dsn);
    await api("PATCH", `/api/bots/${bot.id}`, { dataConnections: { pg: {} } });
    const minted = await api("POST", "/api/testing/internal-capability", { botId: bot.id, threadId: bot.activeTaskId, kind: "data" }, 201, { "x-openmausbot-test-capability": CAPABILITY_KEY });
    const result = (await api("POST", "/api/internal/data/mcp", { method: "tools/call", params: { name: "data_sql", arguments: { on: "pg", sql: "SELECT 1 AS n" } } }, 200, { authorization: `Bearer ${minted.token}` })).result;
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent.rows).toEqual([[1]]);
    expect(JSON.stringify(result)).not.toContain(dsn);
  } finally {
    await waitForExit(server, { signal: "SIGTERM" });
    rmSync(dataDir, { recursive: true, force: true });
  }
}, 180_000);


