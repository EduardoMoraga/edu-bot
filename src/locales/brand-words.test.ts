// A person sees only "Edu Bot": in the English, Spanish and Portuguese packs and on the companion's own pages and
// errors. Lower-case ids the phone apps and older servers check (`openmausbot:` messages, `x-openmausbot-*` headers,
// `_openmausbot._tcp`, `app: "openmausbot"`) are compatibility, not words a person reads.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const SHOWN_PACKS = ["en", "es", "pt-br"];
const OLD_NAME = /OpenMaus|MausBot|\bMaus\b/i;
const OLD_DISPLAY_NAME = /OpenMaus|MausBot|\bMaus\b/;
const COMPANION_NOT_SHOWN = /(\.test\.ts|e2e\/gen-vectors\.ts|e2e\/vectors\/)$|e2e\/vectors\//;

const codeLines = (text: string) => text.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).map((line) => line.replace(/\s\/\/ .*$/, ""));

describe("the product's name where a person reads it", () => {
  it.each(SHOWN_PACKS)("%s pack says Edu Bot, never the old name", (code) => {
    const pack = JSON.parse(readFileSync(join(ROOT, "src", "locales", `${code}.json`), "utf8")) as Record<string, string>;
    expect(Object.entries(pack).filter(([, value]) => OLD_NAME.test(value))).toEqual([]);
  });

  it("the companion's pages and errors say Edu Bot", () => {
    const dir = join(ROOT, "companion", "src");
    const shown = readdirSync(dir, { recursive: true, encoding: "utf8" }).map((file) => file.split("\\").join("/")).filter((file) => file.endsWith(".ts") && !COMPANION_NOT_SHOWN.test(file));
    const found = shown.flatMap((file) => codeLines(readFileSync(join(dir, file), "utf8"))
      .filter((line) => OLD_DISPLAY_NAME.test(line)).map((line) => `${file}: ${line.trim()}`));
    expect(found).toEqual([]);
  });

  it("catches a new string that brings the old name back", () => {
    expect(OLD_NAME.test("Update the MausBot phone app")).toBe(true);
    expect(OLD_NAME.test("Edu Bot is based on OpenMausBot.")).toBe(true);
    expect(OLD_DISPLAY_NAME.test('const CONTROL_TOKEN_HEADER = "x-openmausbot-control-token";')).toBe(false);
  });
});
