import { holdsCredential, redactSecretsInText } from "./redact.ts";

/** A line of a profile file that holds a key (`key`) or an address with a user name or password (`address`). */
export interface Leak {
  line: number;
  kind: "key" | "address";
}

const INVISIBLE = /(?![\t ])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}\p{Default_Ignorable_Code_Point}]/u;
const INVISIBLES = new RegExp(INVISIBLE.source, "gu");
const URL_TOKEN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`]+/gi;
const BASE64_TOKEN = /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{16,4096}={0,2}(?![A-Za-z0-9+/=_-])/g;
const PRIVATE_KEY_HEADER = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const SLOT_NAME = String.raw`\s*:\s*["']?[A-Za-z][A-Za-z0-9_-]{0,63}["']?\s*`;
const SECRET_SLOT_KEY = new RegExp(String.raw`(?<=\{\s*)secret(?=${SLOT_NAME}\})|(?<=^\s*)secret(?=${SLOT_NAME}$)`, "g");
const COMMENT_START = /(?:^|\s)#/;
const MAX_BASE64_DEPTH = 2;
const MAX_JOINED_LEAKS = 10;

function hasUserInfo(address: string): boolean {
  try {
    const url = new URL(address);
    return Boolean(url.username || url.password);
  } catch {
    return false;
  }
}

function decodeBase64(token: string): string[] {
  const plain = token.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  if (plain.length % 4 === 1) return [];
  let binary: string;
  try {
    binary = atob(plain + "=".repeat((4 - (plain.length % 4)) % 4));
  } catch {
    return [];
  }
  const utf8 = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  return utf8 === binary ? [binary] : [binary, utf8];
}

function withoutBreaksOrInvisibles(text: string): string {
  return text.split("\n").map((line) => line.trimStart()).join("").replace(INVISIBLES, "");
}

function firstDifference(a: string, b: string): number {
  const end = Math.min(a.length, b.length);
  let index = 0;
  while (index < end && a[index] === b[index]) index++;
  return Math.min(index, a.length - 1);
}

function firstLeak(text: string, depth = 0): { index: number; kind: Leak["kind"] } | null {
  const redacted = redactSecretsInText(text);
  if (redacted !== text) return { index: firstDifference(text, redacted), kind: "key" };
  if (holdsCredential(text)) return { index: Math.max(0, text.search(PRIVATE_KEY_HEADER)), kind: "key" };
  for (const match of text.matchAll(URL_TOKEN)) if (hasUserInfo(match[0])) return { index: match.index, kind: "address" };
  if (depth >= MAX_BASE64_DEPTH) return null;
  for (const match of text.matchAll(BASE64_TOKEN)) {
    if (decodeBase64(match[0]).some((decoded) => leakAt(decoded, depth + 1))) return { index: match.index, kind: "key" };
  }
  return null;
}

function leakAt(text: string, depth: number): Leak["kind"] | null {
  return firstLeak(text, depth)?.kind ?? firstLeak(withoutBreaksOrInvisibles(text), depth)?.kind ?? null;
}

/** Whether one value holds a key or an address with a user name or password, as written or with its line breaks,
 * indentation, control and format characters and spaces other than U+0020 taken out. Each base64 decoding, as bytes
 * and as UTF-8, is checked the same way. */
export function leakIn(value: string): Leak["kind"] | null {
  return leakAt(value, 0);
}

/** The first control, format or invisible character on each of the first `lines` lines of `source`; tab and U+0020
 * are allowed. */
export function findInvisibles(source: string, lines: number): Array<{ line: number; codePoint: number }> {
  const found: Array<{ line: number; codePoint: number }> = [];
  source.split("\n").slice(0, lines).forEach((text, index) => {
    const char = INVISIBLE.exec(text)?.[0];
    if (char) found.push({ line: index + 1, codePoint: char.codePointAt(0)! });
  });
  return found;
}

function blankSlotKeys(line: string): string {
  const comment = line.search(COMMENT_START);
  const code = comment < 0 ? line : line.slice(0, comment);
  return code.replace(SECRET_SLOT_KEY, "      ") + line.slice(code.length);
}

/** Every line of `source` that holds a key or an address with a user name or password. Each line is checked as written,
 * then the whole file again with line breaks, indentation, control and format characters and spaces other than U+0020
 * taken out, so a key split across lines or by an invisible character is still found. A short base64 token is decoded
 * and checked too, up to two wraps deep. In the first `frontMatterLines` lines, the field name of a secret slot
 * (`{ secret: NAME }`, or `secret: NAME` alone on a line) is not read as a written secret; everything from a `#` that
 * follows a space or starts the line is read as written. */
export function findLeaks(source: string, frontMatterLines = 0): Leak[] {
  const lines = source.split("\n").map((line, index) => index < frontMatterLines ? blankSlotKeys(line) : line);
  const leaks = new Map<number, Leak>();
  lines.forEach((line, index) => {
    const leak = firstLeak(line);
    if (leak) leaks.set(index + 1, { line: index + 1, kind: leak.kind });
  });
  const kept: string[] = [];
  const lineAt: number[] = [];
  lines.forEach((line, index) => {
    for (const char of line.trimStart()) {
      if (INVISIBLE.test(char)) continue;
      kept.push(char);
      for (let unit = 0; unit < char.length; unit++) lineAt.push(index + 1);
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
