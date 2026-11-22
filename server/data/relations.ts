// Tables a statement reads or writes. A name this scan cannot place is unresolvable: the statement is refused
// rather than run against a named connection. singleStatement still owns the one-statement rule; this lexer
// keeps nested tokens so a subquery is walked instead of skipped.
import { singleStatement } from "./sql-statements.ts";

export interface Relation {
  catalog?: string;
  schema?: string;
  table: string;
  /** Set when the name is the bot's own main or omb_results, not the attached database. */
  own: boolean;
  start: number;
  end: number;
}

export type RelationScan = { ok: true; relations: Relation[] } | { ok: false };

interface Tok {
  kind: "word" | "ident" | "punct" | "paren";
  text: string;
  start: number;
  end: number;
  inner?: Tok[];
}

const key = (tok?: Tok) => (tok?.text ?? "").toUpperCase();
const REL_INTRO = new Set(["FROM", "JOIN", "INTO", "UPDATE", "TABLE"]);
const STOP = new Set([
  "WHERE", "GROUP", "ORDER", "LIMIT", "OFFSET", "UNION", "EXCEPT", "INTERSECT", "WINDOW", "QUALIFY", "HAVING",
  "ON", "USING", "SET", "RETURNING", "VALUES", "JOIN", "LEFT", "RIGHT", "FULL", "INNER", "CROSS", "NATURAL", "SELECT",
  "PIVOT", "UNPIVOT", "QUALIFY",
]);

export function extractRelations(sql: string): RelationScan {
  let end = sql.length;
  try {
    end = singleStatement(sql).end;
  } catch {
    return { ok: false };
  }
  const relations: Relation[] = [];
  const failed = { current: false };
  walk(lex(sql, 0, end), new Set(), relations, failed);
  if (failed.current) return { ok: false };
  return { ok: true, relations };
}

/** Replace attached relations with "alias"."schema"."table", from the end so earlier spans stay put. */
export function qualifyRelations(sql: string, relations: readonly Relation[], alias: string, schemaFor: (relation: Relation) => string): string {
  const quoted = (name: string) => `"${name.replace(/"/g, '""')}"`;
  let out = sql;
  for (const relation of [...relations].filter((relation) => !relation.own).sort((a, b) => b.start - a.start)) {
    const schema = relation.schema ?? schemaFor(relation);
    out = `${out.slice(0, relation.start)}${quoted(alias)}.${quoted(schema)}.${quoted(relation.table)}${out.slice(relation.end)}`;
  }
  return out;
}

function walk(tokens: Tok[], ctes: Set<string>, relations: Relation[], failed: { current: boolean }): void {
  if (failed.current) return;
  const local = new Set(ctes);
  let i = 0;
  if (tokens[0]?.kind === "word" && key(tokens[0]) === "WITH") {
    i = key(tokens[1]) === "RECURSIVE" ? 2 : 1;
    while (i < tokens.length && !failed.current) {
      const name = tokens[i];
      if (!name || (name.kind !== "word" && name.kind !== "ident")) { failed.current = true; return; }
      local.add(unquote(name).toLowerCase());
      while (i < tokens.length && tokens[i]?.kind !== "paren") i++;
      const body = tokens[i];
      if (body?.kind !== "paren" || !body.inner) { failed.current = true; return; }
      walk(body.inner, local, relations, failed);
      i++;
      if (tokens[i]?.kind === "punct" && tokens[i]?.text === ",") { i++; continue; }
      break;
    }
  }
  for (; i < tokens.length && !failed.current; i++) {
    const tok = tokens[i]!;
    if (tok.kind === "paren" && tok.inner) { walk(tok.inner, local, relations, failed); continue; }
    if (tok.kind !== "word" || !REL_INTRO.has(key(tok))) continue;
    i = readList(tokens, i + 1, local, relations, failed);
  }
}

function readList(tokens: Tok[], start: number, ctes: Set<string>, relations: Relation[], failed: { current: boolean }): number {
  let i = start;
  while (i < tokens.length && !failed.current) {
    if (key(tokens[i]) === "ONLY") i++;
    const tok = tokens[i];
    if (!tok) break;
    if (tok.kind === "paren" && tok.inner) {
      const first = tok.inner.find((item) => item.kind === "word" || item.kind === "ident");
      if (first?.kind === "word" && ["SELECT", "WITH", "VALUES", "FROM"].includes(key(first))) {
        walk(tok.inner, ctes, relations, failed);
        i = skipAlias(tokens, i + 1);
      } else {
        failed.current = true;
        return i;
      }
    } else if (tok.kind === "word" || tok.kind === "ident") {
      if (tokens[i + 1]?.kind === "paren") { failed.current = true; return i; }
      const name = readName(tokens, i);
      if (!name) { failed.current = true; return i; }
      i = name.next;
      const relation = toRelation(name.parts, name.start, name.end);
      if (!relation) { failed.current = true; return i; }
      const cte = !relation.schema && !relation.catalog && ctes.has(relation.table.toLowerCase());
      if (!cte) relations.push(relation);
      i = skipAlias(tokens, i);
    } else break;
    if (tokens[i]?.kind === "punct" && tokens[i]?.text === ",") { i++; continue; }
    break;
  }
  return i - 1;
}

function skipAlias(tokens: Tok[], i: number): number {
  if (key(tokens[i]) === "AS") return i + 2;
  const next = tokens[i];
  if (next?.kind === "word" && !STOP.has(key(next)) && !REL_INTRO.has(key(next)) && key(next) !== "AS") return i + 1;
  if (next?.kind === "ident") return i + 1;
  return i;
}

function readName(tokens: Tok[], i: number): { parts: string[]; start: number; end: number; next: number } | null {
  const first = tokens[i];
  if (!first || (first.kind !== "word" && first.kind !== "ident")) return null;
  const parts = splitPart(first);
  let end = first.end;
  let j = i + 1;
  while (tokens[j]?.kind === "punct" && tokens[j]?.text === "." && (tokens[j + 1]?.kind === "word" || tokens[j + 1]?.kind === "ident")) {
    parts.push(...splitPart(tokens[j + 1]!));
    end = tokens[j + 1]!.end;
    j += 2;
  }
  if (parts.some((part) => !part || part === "*")) return null;
  return { parts, start: first.start, end, next: j };
}

function toRelation(parts: string[], start: number, end: number): Relation | null {
  const table = parts[parts.length - 1];
  if (!table) return null;
  const schema = parts.length >= 2 ? parts[parts.length - 2] : undefined;
  const catalog = parts.length >= 3 ? parts[parts.length - 3] : undefined;
  if (parts.length > 3) return null;
  const own = !catalog && (schema?.toLowerCase() === "main" || schema?.toLowerCase() === "omb_results");
  return { ...(catalog ? { catalog } : {}), ...(schema ? { schema } : {}), table, own, start, end };
}

function splitPart(tok: Tok): string[] {
  return unquote(tok).split(".").filter((part) => part.length > 0);
}

function unquote(tok: Tok): string {
  if (tok.kind === "ident") return tok.text.replace(/""/g, '"');
  return tok.text;
}

function lex(sql: string, from: number, until: number): Tok[] {
  const tokens: Tok[] = [];
  let i = from;
  const push = (kind: Tok["kind"], start: number, end: number, text: string, inner?: Tok[]) => {
    tokens.push({ kind, text, start, end, ...(inner ? { inner } : {}) });
  };
  while (i < until) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === "-" && next === "-") { const nl = sql.slice(i, until).search(/[\n\r]/); i = nl === -1 ? until : i + nl + 1; continue; }
    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < until - 1 && depth) {
        if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; continue; }
        if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; continue; }
        i++;
      }
      continue;
    }
    if (ch === "'") { i = skipString(sql, i, until); continue; }
    if (ch === "$") {
      const delimiter = /\$(?:[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*)?\$/y;
      delimiter.lastIndex = i;
      const open = delimiter.exec(sql)?.[0];
      if (open && i + open.length <= until) {
        const close = sql.indexOf(open, i + open.length);
        i = close === -1 || close > until ? until : close + open.length;
        continue;
      }
    }
    if (ch === '"') {
      const start = i;
      let j = i + 1;
      for (;;) {
        const q = sql.indexOf('"', j);
        if (q === -1 || q >= until) return tokens;
        if (sql[q + 1] === '"') { j = q + 2; continue; }
        j = q + 1;
        break;
      }
      push("ident", start, j, sql.slice(start + 1, j - 1));
      i = j;
      continue;
    }
    if (ch === "(") {
      const start = i;
      let depth = 1;
      let j = i + 1;
      while (j < until && depth) {
        if (sql[j] === "(") depth++;
        else if (sql[j] === ")") depth--;
        if (depth) j++;
      }
      const end = Math.min(until, j + 1);
      push("paren", start, end, "(…)", lex(sql, i + 1, j));
      i = end;
      continue;
    }
    if (/[A-Za-z_\u0080-\uffff]/.test(ch)) {
      const start = i;
      let j = i + 1;
      while (j < until && /[A-Za-z0-9_$.\u0080-\uffff]/.test(sql[j]!)) j++;
      push("word", start, j, sql.slice(start, j));
      i = j;
      continue;
    }
    if (ch === "," || ch === ".") { push("punct", i, i + 1, ch); i++; continue; }
    i++;
  }
  return tokens;
}

function skipString(sql: string, quote: number, until: number): number {
  for (let j = quote + 1; j < until; j++) {
    if (sql[j] === "\\" && /[eE]/.test(sql[quote - 1] ?? "")) { j++; continue; }
    if (sql[j] !== "'") continue;
    if (sql[j + 1] === "'") { j++; continue; }
    return j + 1;
  }
  return until;
}
