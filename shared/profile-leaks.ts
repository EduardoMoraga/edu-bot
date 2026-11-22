import { holdsCredential, redactSecretsInText } from "./redact.ts";

/** A line of a profile file that holds a key (`key`) or an address with a user name or password (`address`). */
export interface Leak {
  line: number;
  kind: "key" | "address";
}

const INVISIBLE = /[\u00ad\u180e\u200b-\u200f\u2028\u2029\u2060-\u2064\ufeff]/;
const INVISIBLES = new RegExp(INVISIBLE.source, "g");
const URL_TOKEN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi;
const BASE64_TOKEN = /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{16,4096}={0,2}(?![A-Za-z0-9+/=_-])/g;
const PRIVATE_KEY_HEADER = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const SECRET_SLOT_KEY = /\bsecret(?=\s*:\s*["']?[A-Za-z][A-Za-z0-9_-]{0,63}["']?\s*(?:[},#]|$))/gm;
const MAX_JOINED_LEAKS = 10;

const holdsKey = (text: string) => redactSecretsInText(text) !== text || holdsCredential(text);

function hasUserInfo(address: string): boolean {
  try {
    const url = new URL(address);
    return Boolean(url.username || url.password);
  } catch {
    return false;
  }
}

function decodeBase64(token: string): string | null {
  const plain = token.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  if (plain.length % 4 === 1) return null;
  try {
    return atob(plain + "=".repeat((4 - (plain.length % 4)) % 4));
  } catch {
    return null;
  }
}

function firstDifference(a: string, b: string): number {
  const end = Math.min(a.length, b.length);
  let index = 0;
  while (index < end && a[index] === b[index]) index++;
  return Math.min(index, a.length - 1);
}

function firstLeak(text: string): { index: number; kind: Leak["kind"] } | null {
  const redacted = redactSecretsInText(text);
  if (redacted !== text) return { index: firstDifference(text, redacted), kind: "key" };
  if (holdsCredential(text)) return { index: Math.max(0, text.search(PRIVATE_KEY_HEADER)), kind: "key" };
  for (const match of text.matchAll(URL_TOKEN)) if (hasUserInfo(match[0])) return { index: match.index, kind: "address" };
  for (const match of text.matchAll(BASE64_TOKEN)) {
    const decoded = decodeBase64(match[0]);
    if (decoded && holdsKey(decoded)) return { index: match.index, kind: "key" };
  }
  return null;
}

/** Whether one value holds a key or an address with a user name or password, as written or with its line breaks,
 * indentation and invisible characters taken out. */
export function leakIn(value: string): Leak["kind"] | null {
  return firstLeak(value)?.kind ?? firstLeak(value.split("\n").map((line) => line.trimStart()).join("").replace(INVISIBLES, ""))?.kind ?? null;
}

/** Every line of `source` that holds a key or an address with a user name or password. Each line is checked as written,
 * then the whole file again with line breaks, indentation and invisible characters taken out, so a key split across lines or by a
 * zero-width character is still found. A short base64 token is decoded and checked too. In the first
 * `frontMatterLines` lines, the field name of a `{ secret: NAME }` slot is not read as a written secret. */
export function findLeaks(source: string, frontMatterLines = 0): Leak[] {
  const lines = source.split("\n").map((line, index) => index < frontMatterLines ? line.replace(SECRET_SLOT_KEY, "      ") : line);
  const leaks = new Map<number, Leak>();
  lines.forEach((line, index) => {
    const leak = firstLeak(line);
    if (leak) leaks.set(index + 1, { line: index + 1, kind: leak.kind });
  });
  const kept: string[] = [];
  const lineAt: number[] = [];
  lines.forEach((line, index) => {
    for (let i = line.length - line.trimStart().length; i < line.length; i++) {
      if (INVISIBLE.test(line[i]!)) continue;
      kept.push(line[i]!);
      lineAt.push(index + 1);
    }
  });
  const joined = kept.join("");
  let offset = 0;
  for (let found = 0; found < MAX_JOINED_LEAKS && offset < joined.length; found++) {
    const leak = firstLeak(joined.slice(offset));
    if (!leak) break;
    const line = lineAt[offset + leak.index]!;
    if (!leaks.has(line)) leaks.set(line, { line, kind: leak.kind });
    while (offset < lineAt.length && lineAt[offset]! <= line) offset++;
  }
  return [...leaks.values()].sort((a, b) => a.line - b.line);
}
