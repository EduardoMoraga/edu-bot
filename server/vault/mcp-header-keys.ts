// A key the person types for a URL MCP server's header (a personal access token on a hosted server's card): the value
// goes to the Vault and the server's header holds its `vault:<id>` pointer.
// Security: the typed value is never written to config.json, which is copied, exported and read by bots with a terminal.
import { randomUUID } from "node:crypto";

import type { VaultStore } from "../vault-store.ts";
import { vaultPointer } from "./mcp-keys.ts";

export interface TypedHeaderKey { header: string; scheme?: string; value: string }

const MAX_TYPED_KEYS = 8;
const MAX_VALUE_BYTES = 4096;
const SCHEME = /^[A-Za-z][A-Za-z0-9-]{0,31}$/u;
const NAME_SUFFIX = " (MCP server)";

/** `vaultHeaders` of an add or edit request: `{ "<header>": { value, scheme? } }`. */
export function typedHeaderKeys(raw: unknown): { ok: true; keys: TypedHeaderKey[] } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, keys: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "vaultHeaders must be an object of header names." };
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_TYPED_KEYS) return { ok: false, error: `Use at most ${MAX_TYPED_KEYS} keys.` };
  const keys: TypedHeaderKey[] = [];
  for (const [header, entry] of entries) {
    const { value, scheme } = (entry && typeof entry === "object" ? entry : {}) as { value?: unknown; scheme?: unknown };
    const text = typeof value === "string" ? value.trim() : "";
    if (!text || Buffer.byteLength(text) > MAX_VALUE_BYTES || /[\r\n]/u.test(text)) return { ok: false, error: `Enter the key for ${header.slice(0, 64)} on one line.` };
    if (scheme !== undefined && (typeof scheme !== "string" || !SCHEME.test(scheme))) return { ok: false, error: `That is not a scheme for ${header.slice(0, 64)}.` };
    keys.push({ header, value: text, ...(scheme === undefined ? {} : { scheme }) });
  }
  return { ok: true, keys };
}

/** The header values a server is stored with: each typed key as a pointer to `items[i]`. */
export function pointerHeaders(keys: readonly TypedHeaderKey[], items: readonly string[]): Record<string, string> {
  return Object.fromEntries(keys.map((key, index) => [key.header, `${key.scheme ? `${key.scheme} ` : ""}${vaultPointer(items[index]!)}`]));
}

/** Items that stand in for the real ones while a server is checked, before any key is saved. */
export const placeholderItems = (keys: readonly TypedHeaderKey[]): string[] => keys.map(() => randomUUID());

export interface McpHeaderKeys {
  /** Saves each typed key as `server`'s own, replacing the one it typed before, and returns the Vault items in order. */
  save(server: string, keys: readonly TypedHeaderKey[]): string[];
  /** The items `save` made for `server` that no other server reads. */
  madeFor(server: string): string[];
  remove(items: readonly string[]): void;
}

export function createMcpHeaderKeys(store: Pick<VaultStore, "saveSecret" | "secret" | "removeSecret" | "mcpServerKeys" | "serversUsingKey">): McpHeaderKeys {
  const nameOf = (server: string, header: string) => `${server} ${header}${NAME_SUFFIX}`;
  return {
    save: (server, keys) => keys.map((key) => store.saveSecret({ name: nameOf(server, key.header), value: key.value, source: "settings", bots: "all", refOnly: true }).id),
    madeFor: (server) => store.mcpServerKeys(server).filter((item) => {
      const secret = store.secret(item);
      return secret !== null && secret.source === "settings" && secret.name.startsWith(`${server} `) && secret.name.endsWith(NAME_SUFFIX)
        && store.serversUsingKey(item).every((user) => user === server);
    }),
    remove: (items) => { for (const item of items) store.removeSecret(item); },
  };
}
