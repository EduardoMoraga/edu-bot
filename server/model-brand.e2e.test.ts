// What a model reads names the product Edu Bot: the system prompts the engine receives for the built-in helper, an
// ordinary bot and a Chief of Staff, the agents tools they are handed, the catalog goldens of every profile, and the
// bundled skills. The fake engine holds each turn open so its launch record and its agents server can be read.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { helperIntroMessage, HELPER_ASKS } from "./default-bot.ts";
import { waitForExit } from "./testing/cleanup.ts";
import { childEnv } from "./testing/omb-env.ts";

const OLD_NAME = /OpenMaus|MausBot|\bMaus\b/i;
/** Ids a model may see that stay for compatibility: the bundled docs skill's id, which bots and saved skill lists name,
 * and the `mausbot` module and `window.mausbot` API that published pages and room apps already call. */
const KEPT_IDS = /openmausbot-docs|openmausbot-verify-data-\w+|\bmausbot(?=\.(?:send|open|setContext)\b|\?\.)|(?<=["`])maus(?:bot)?(?=\\?["`])|\bmaus(?= \(default\))/g;
const ROOT = join(import.meta.dirname, "..");

type McpServer = { command: string; args: string[]; env: Record<string, string> };

async function toolsList(server: McpServer): Promise<unknown> {
  const child = spawn(server.command, server.args, { env: childEnv(server.env), stdio: ["pipe", "pipe", "inherit"] });
  try {
    return await new Promise<unknown>((resolve, reject) => {
      let buffer = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline !== -1) resolve(JSON.parse(buffer.slice(0, newline)));
      });
      child.on("exit", (code) => reject(new Error(`the agents server exited (${code}) before answering`)));
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`);
    });
  } finally {
    await waitForExit(child, { signal: "SIGTERM" });
  }
}

/** Each place `text` names the old product, with the words around it, for a failure message that says where. */
function oldNames(label: string, text: string): string[] {
  const kept = text.replace(KEPT_IDS, "");
  return [...kept.matchAll(new RegExp(`.{0,80}(?:${OLD_NAME.source}).{0,60}`, "gi"))].map((match) => `${label}: ${match[0]}`);
}

function bundledSkills(): Array<[string, string]> {
  const dir = join(ROOT, "skills");
  return readdirSync(dir).flatMap((skill): Array<[string, string]> => {
    const manifest = JSON.parse(readFileSync(join(dir, skill, "manifest.json"), "utf8")) as { name: string; description: string };
    return [[`skills/${skill}/SKILL.md`, readFileSync(join(dir, skill, "SKILL.md"), "utf8")], [`skills/${skill}/manifest.json`, `${manifest.name}\n${manifest.description}`]];
  });
}

function catalogGoldens(): Array<[string, string]> {
  const dir = join(ROOT, "server", "drivers", "agents-catalog-goldens");
  return readdirSync(dir).filter((file) => file.endsWith(".tools-list.json")).map((file) => [`goldens/${file}`, readFileSync(join(dir, file), "utf8")]);
}

it("names the product Edu Bot in every prompt, tool and bundled skill a model reads", async () => {
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "hang" });
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${fixture.info.url}${path}`, { method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    return { status: response.status, body: await response.json() as any };
  };
  const control = (args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
  const launch = async (botId: string) => {
    await control(["send", "--bot", botId, "--text", "Who are you?"]);
    await expect.poll(() => existsSync(fixture.fixtureDumpPath), { timeout: 30_000 }).toBe(true);
    const dump = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as { systemPrompt: string; prompt: unknown; mcpConfig: { mcpServers: Record<string, McpServer> } };
    rmSync(fixture.fixtureDumpPath, { force: true });
    await control(["interrupt", "--bot", botId]);
    return dump;
  };
  const found: string[] = [];
  try {
    const [helper] = (await api("GET", "/api/bots")).body.bots as any[];
    expect(helper).toMatchObject({ defaultBot: {}, chiefOfStaff: true });
    const helperTurn = await launch(helper.id);
    expect(helperTurn.systemPrompt).toContain("built-in helper for everything in Edu Bot");

    const { bot: clive } = await control(["new-bot", "--name", "Clive"]);
    const plainTurn = await launch(clive.id);
    expect(plainTurn.systemPrompt).toContain("You are Clive, a personal bot in Edu Bot.");

    expect((await api("PATCH", `/api/bots/${clive.id}`, { chiefOfStaff: true })).status).toBe(200);
    const chiefTurn = await launch(clive.id);

    for (const [who, turn] of [["helper", helperTurn], ["bot", plainTurn], ["chief", chiefTurn]] as const) {
      found.push(...oldNames(`${who} system prompt`, turn.systemPrompt), ...oldNames(`${who} prompt`, JSON.stringify(turn.prompt)));
      for (const [name, server] of Object.entries(turn.mcpConfig.mcpServers)) {
        if (name === "agents") found.push(...oldNames(`${who} agents tools`, JSON.stringify(await toolsList(server))));
      }
    }
  } finally {
    await fixture.close();
  }
  const intro = helperIntroMessage({ name: "Edu", chiefOfStaff: false });
  found.push(...oldNames("helper intro", JSON.stringify(intro)), ...oldNames("helper asks", HELPER_ASKS.join("\n")));
  for (const [label, text] of [...catalogGoldens(), ...bundledSkills()]) found.push(...oldNames(label, text));
  expect(found).toEqual([]);
}, 180_000);
