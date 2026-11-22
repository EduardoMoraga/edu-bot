// Named databases and the per-bot grant. A raw DSN is never a grant and never a tool argument.
import type { DataGrant, DataGrantMap } from "../packages/phone-protocol/src/data-connections.ts";

export type { DataGrant, DataGrantMap };

export const CONNECTION_NAME = /^[a-z][a-z0-9_]{0,31}$/;

export const RESERVED_CONNECTION_NAMES = new Set(["data", "main", "memory", "temp", "system"]);

/** Shown instead of any connection string a tool was given. The string itself is not repeated. */
export const NAMED_CONNECTION_SENTENCE =
  "Add a named connection in Settings → Data, then query it with data_sql on: that name. A password is never typed into a tool.";

const URL_DSN = /\b(?:postgres(?:ql)?|mysql|mariadb|sqlite|duckdb|mssql|sqlserver|mongodb(?:\+srv)?|rediss?|clickhouse|oracle):\/\/\S+/i;
const KEYWORD_DSN = /\b(?:host(?:addr)?|password|passwd|pwd)\s*=\s*\S+/i;
const ODBC_DSN = /\b(?:driver|dsn)\s*=\s*\S+/i;
const ENV_DSN = /\$\{[A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|DSN|URL)[A-Za-z0-9_]*\}|\$[A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|DSN|URL)[A-Z0-9_]*/;

/** A database URL, a keyword or ODBC DSN, or an env var whose name holds a secret. `SELECT password FROM t` is not one. */
export function containsRawDsn(text: string): boolean {
  return URL_DSN.test(text) || KEYWORD_DSN.test(text) || ODBC_DSN.test(text) || ENV_DSN.test(text);
}

export function connectionNameError(name: string): string | null {
  if (!CONNECTION_NAME.test(name)) return "A connection name is lowercase letters, digits and underscores, and starts with a letter.";
  if (RESERVED_CONNECTION_NAMES.has(name)) return `${name} is reserved`;
  return null;
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
    const nameError = connectionNameError(name);
    if (nameError) return { ok: false, error: nameError.includes("reserved") ? `dataConnections.${name} is reserved` : `dataConnections.${name} is not a connection name` };
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

function listWidens(had: string[] | undefined, next: string[] | undefined): boolean {
  if (!next) return Boolean(had);
  if (!had) return false;
  const have = new Set(had.map((item) => item.toLowerCase()));
  return next.some((item) => !have.has(item.toLowerCase()));
}
