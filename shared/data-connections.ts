// Named databases and the per-bot grant. A raw DSN is never a grant and never a tool argument.
import type { DataGrant, DataGrantMap } from "../packages/phone-protocol/src/data-connections.ts";

export type { DataGrant, DataGrantMap };

export const CONNECTION_NAME = /^[a-z][a-z0-9_]{0,31}$/;

/** Shown instead of any connection string a tool was given. The string itself is not repeated. */
export const NAMED_CONNECTION_SENTENCE =
  "Add a named connection in Settings → Data, then query it with data_sql on: that name. A password is never typed into a tool.";

const URL_DSN = /\b(?:postgres(?:ql)?|mysql):\/\/\S+/i;
const KEYWORD_DSN = /\b(?:host|password|passwd)\s*=\s*\S+/i;

/** A postgres or mysql URL, or a keyword DSN (`host=` / `password=`). `SELECT password FROM t` is not one. */
export function containsRawDsn(text: string): boolean {
  return URL_DSN.test(text) || KEYWORD_DSN.test(text);
}

const NAME_MAX = 32;
const LIST_MAX = 200;
const ITEM_MAX = 128;

export function parseDataGrants(value: unknown): { ok: true; grants: DataGrantMap } | { ok: false; error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "dataConnections must be an object of connection grants" };
  const entries = Object.entries(value);
  if (entries.length > NAME_MAX) return { ok: false, error: "dataConnections names at most 32 connections" };
  const grants: DataGrantMap = {};
  for (const [name, raw] of entries) {
    if (!CONNECTION_NAME.test(name)) return { ok: false, error: `dataConnections.${name} is not a connection name` };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: `dataConnections.${name} must be a grant` };
    const body = raw as Record<string, unknown>;
    const known = new Set(["schemas", "tables", "write"]);
    for (const key of Object.keys(body)) if (!known.has(key)) return { ok: false, error: `dataConnections.${name}.${key} is not a grant field` };
    const schemas = listField(body.schemas, `dataConnections.${name}.schemas`);
    if (typeof schemas === "string") return { ok: false, error: schemas };
    const tables = listField(body.tables, `dataConnections.${name}.tables`);
    if (typeof tables === "string") return { ok: false, error: tables };
    if (body.write !== undefined && body.write !== "never" && body.write !== "ask") return { ok: false, error: `dataConnections.${name}.write must be never or ask` };
    grants[name] = {
      ...(schemas ? { schemas } : {}),
      ...(tables ? { tables } : {}),
      ...(body.write === "never" || body.write === "ask" ? { write: body.write } : {}),
    };
  }
  return { ok: true, grants };
}

function listField(value: unknown, label: string): string[] | undefined | string {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > LIST_MAX || value.some((item) => typeof item !== "string" || !item.trim() || item.length > ITEM_MAX)) {
    return `${label} must be a list of names`;
  }
  return value.map((item) => item.trim());
}

/** True when `file` lets the bot read or write something `app` does not already allow. An empty grant reads the whole connection. */
export function dataGrantWidens(app: DataGrantMap | null | undefined, file: DataGrantMap | null | undefined): boolean {
  const next = file ?? {};
  const current = app ?? {};
  for (const [name, grant] of Object.entries(next)) {
    const had = current[name];
    if (!had) return true;
    if (grant.write === "ask" && had.write !== "ask") return true;
    if (listWidens(had.schemas, grant.schemas) || listWidens(had.tables, grant.tables)) return true;
  }
  return false;
}

/** Undefined means every name. A list widens when it adds a name the other list does not have. */
function listWidens(had: string[] | undefined, next: string[] | undefined): boolean {
  if (!next) return Boolean(had);
  if (!had) return false;
  const have = new Set(had.map((item) => item.toLowerCase()));
  return next.some((item) => !have.has(item.toLowerCase()));
}
