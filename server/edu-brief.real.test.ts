// Runs only where Edu 6+ is installed (CI has none). Every brain is in a temporary folder.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { createEduBrains, locateEduCli } from "./edu-brain.ts";
import { EDU_RULES_PROMPT } from "./edu-brief.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const cli = locateEduCli({ PATH: process.env.PATH }, process.env.PATH ?? "");
const root = mkdtempSync(join(tmpdir(), "edu-brief-real-"));
afterAll(() => removeTempDir(root));

describe.skipIf(!cli)("the installed Edu binary's brief", () => {
  const dataDir = join(root, "data"), eduHome = join(root, "global"), home = join(root, "home");
  const env = { ...process.env, HOME: home, USERPROFILE: home, OMB_EDU_CLI: cli! };
  const edu = (args: string[]) => execFileSync(process.execPath, [cli!, ...args], { env: { ...env, EDU_HOME: eduHome }, cwd: home });
  const bot = { id: "bot-brief", name: "Luna" };

  it("reaches the system prompt with the bot's and the global brain's notes, without Edu's host protocol", async () => {
    mkdirSync(home, { recursive: true });
    edu(["init", "--global", "--name", "Global"]);
    edu(["brain", "remember", "Answers are in Spanish", "--kind", "decision", "--band", "verified", "--body", "Global fixture"]);
    const brains = createEduBrains({ dataDir, config: () => ({ home: eduHome }), env });
    const ready = await brains.brain(bot);
    expect(ready.ok).toBe(true);
    edu(["--cwd", join(dataDir, "brains", bot.id), "brain", "remember", "Reports go out on Mondays", "--kind", "decision", "--band", "inferred", "--body", "Bot fixture"]);

    const mounted = buildSystemPrompt("You are Luna.", "", await brains.promptParts(bot, {}, true));
    expect(mounted.volatile).toContain("Reports go out on Mondays");
    expect(mounted.volatile).toContain("Answers are in Spanish");
    expect(mounted.stable).toContain(EDU_RULES_PROMPT);
    expect(mounted.text).not.toMatch(/edu:core|edu_crew_dispatch|edu_session_open/);

    const plain = buildSystemPrompt("You are Luna.", "", await brains.promptParts(bot, {}, false));
    expect(plain.volatile).toContain("Reports go out on Mondays");
    expect(plain.text).not.toMatch(/edu_remember|edu_recall|edu_read|edu_propose_canonical/);
  });
});
