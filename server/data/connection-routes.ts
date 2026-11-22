// Settings → Data. Mutations need the owner's admin scope: a bot's service trust cannot add a connection.
import { NAMED_CONNECTION_SENTENCE, containsRawDsn, type DataGrantMap } from "../../shared/data-connections.ts";
import type { RouteContext } from "../routes/table.ts";
import { PASS } from "../routes/table.ts";
import { ConnectionStore, type ConnectionVault } from "./connections.ts";
import { syncConnectionGrants } from "./grants.ts";

export interface ConnectionRouteDeps {
  dataDir?: string;
  vault?: ConnectionVault;
  bots?: () => Array<{ id: string; dataConnections?: DataGrantMap }>;
}

const NAME = /^[a-z][a-z0-9_]{0,31}$/;

export async function handleDataConnectionRoute(ctx: RouteContext, deps: ConnectionRouteDeps): Promise<typeof PASS | void> {
  const path = ctx.path;
  if (path !== "/api/data-connections" && !path.startsWith("/api/data-connections/")) return PASS;
  if (!deps.dataDir || !deps.vault) {
    ctx.json(ctx.res, 503, { error: "Data connections are unavailable." });
    return;
  }
  if (!ctx.auth.scopes.includes("admin")) {
    ctx.json(ctx.res, 403, { error: "Only the owner can change data connections." });
    return;
  }
  const store = new ConnectionStore(deps.dataDir, deps.vault);
  const { method } = ctx;
  try {
    if (path === "/api/data-connections" && method === "GET") {
      ctx.json(ctx.res, 200, store.list());
      return;
    }
    if (path === "/api/data-connections" && method === "POST") {
      const body = await read(ctx);
      if (!body) return;
      const type = body.type;
      if (type !== "postgres" && type !== "sqlite" && type !== "duckdb") {
        ctx.json(ctx.res, 400, { error: "type must be postgres, sqlite or duckdb." });
        return;
      }
      ctx.json(ctx.res, 201, store.add({ name: String(body.name ?? ""), type, dsn: typeof body.dsn === "string" ? body.dsn : undefined, path: typeof body.path === "string" ? body.path : undefined }));
      syncGrants(deps);
      return;
    }
    if (path === "/api/data-connections/folders" && method === "POST") {
      const body = await read(ctx);
      if (!body) return;
      ctx.json(ctx.res, 201, { folder: store.addFolder(String(body.path ?? "")) });
      return;
    }
    if (path === "/api/data-connections/folders" && method === "DELETE") {
      const body = await read(ctx);
      if (!body) return;
      store.removeFolder(String(body.path ?? ""));
      ctx.json(ctx.res, 200, { ok: true });
      return;
    }
    const named = /^\/api\/data-connections\/([a-z][a-z0-9_]{0,31})(\/test)?$/.exec(path);
    if (!named || !NAME.test(named[1]!)) {
      ctx.json(ctx.res, 404, { error: "No such data connection." });
      return;
    }
    if (named[2] === "/test" && method === "POST") {
      const result = await store.test(named[1]!);
      ctx.json(ctx.res, result.ok ? 200 : 422, result);
      return;
    }
    if (!named[2] && method === "DELETE") {
      store.remove(named[1]!);
      syncGrants(deps);
      ctx.json(ctx.res, 200, { ok: true });
      return;
    }
    ctx.json(ctx.res, 404, { error: "No such data connection." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The connection could not be saved.";
    ctx.json(ctx.res, 400, { error: containsRawDsn(message) ? NAMED_CONNECTION_SENTENCE : message });
  }
}

function syncGrants(deps: ConnectionRouteDeps): void {
  if (!deps.dataDir || !deps.vault || !deps.bots) return;
  syncConnectionGrants(deps.vault, deps.dataDir, deps.bots());
}

async function read(ctx: RouteContext): Promise<Record<string, unknown> | undefined> {
  try {
    const body = await ctx.readBody(ctx.req);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      ctx.json(ctx.res, 400, { error: "body must be a JSON object" });
      return undefined;
    }
    return body as Record<string, unknown>;
  } catch (error) {
    ctx.json(ctx.res, 400, { error: error instanceof Error ? error.message : "The request body is not JSON." });
    return undefined;
  }
}
