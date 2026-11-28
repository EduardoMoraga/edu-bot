import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { otherComputersPrompt, REMOTE_LOGIN_ADVICE } from "./other-computers.ts";

const ROOT = join(import.meta.dirname, "..");

/** What a bot on a Mac told a person whose PC was on Tailscale but not lent to it. */
const ADVICE_SEEN = [
  "Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0",
  "Start-Service sshd",
  "Set-Service sshd -StartupType Automatic",
];

function files(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules") return [];
    return statSync(path).isDirectory() ? files(path, keep) : keep(path) ? [path] : [];
  });
}

describe("otherComputersPrompt", () => {
  it("names Edu Bot on the other computer as the only way there, and forbids turning on a remote login", () => {
    for (const tools of [true, false]) {
      const text = otherComputersPrompt(tools);
      expect(text).toContain("reached only through Edu Bot on that computer");
      expect(text).toContain("never tell them to turn on SSH, OpenSSH Server, Remote Desktop or a firewall rule, or to run anything as an administrator");
      expect(text).toContain("don't scan its ports or try its addresses");
      expect(text).not.toMatch(REMOTE_LOGIN_ADVICE);
    }
    expect(otherComputersPrompt(true)).toContain("list_shared_computers");
    expect(otherComputersPrompt(false)).not.toMatch(/list_shared_computers|shared_computer/);
  });

  it("asks for one switch in one sentence, never a menu path or a link to copy", () => {
    const text = otherComputersPrompt(false);
    expect(text).toContain("one short sentence");
    expect(text).toContain("Computadoras, Permitir siempre");
    expect(text).not.toMatch(/Settings →|Phone & devices|Pair a computer|Copy link|Advanced mode|Connect to a server/);
  });

  it("recognises the remote-login advice a bot gave", () => {
    for (const line of ADVICE_SEEN) expect(line).toMatch(REMOTE_LOGIN_ADVICE);
  });
});

it("never sends a person to turn on a remote login, in any prompt, tool, skill or app text", () => {
  const sources = [
    ...files(join(ROOT, "server"), (path) => /\.(ts|json)$/.test(path) && !path.endsWith(".test.ts") && !path.endsWith("other-computers.ts")),
    ...files(join(ROOT, "shared"), (path) => path.endsWith(".ts") && !path.endsWith(".test.ts")),
    ...files(join(ROOT, "skills"), (path) => /\.(md|json)$/.test(path)),
    join(ROOT, "src", "locales", "en.json"),
  ];
  const found = sources.flatMap((path) => {
    const match = readFileSync(path, "utf8").match(REMOTE_LOGIN_ADVICE);
    return match ? [`${relative(ROOT, path)}: ${match[0]}`] : [];
  });
  expect(found).toEqual([]);
});
