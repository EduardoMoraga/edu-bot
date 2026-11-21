// Runs only where Edu 6+ is installed (CI has none). Every brain is in a temporary folder.
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { createEduBrains, locateEduCli, type EduStdioServer } from "./edu-brain.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const cli = locateEduCli({ PATH: process.env.PATH }, process.env.PATH ?? "");
const root = mkdtempSync(join(tmpdir(), "edu-real-"));
afterAll(() => removeTempDir(root));

type Reply = { result?: { isError?: boolean; content?: Array<{ text?: string }>; tools?: Array<{ name: string }> }; error?: { message: string } };

async function session(server: EduStdioServer, extraEnv: Record<string, string>) {
  const child = spawn(server.command, server.args, { env: { ...process.env, ...server.env, ...extraEnv }, stdio: ["pipe", "pipe", "ignore"] });
  const waiting = new Map<number, (reply: Reply) => void>();
  let buffer = "", id = 0;
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      try { const message = JSON.parse(line) as Reply & { id?: number }; if (message.id !== undefined) waiting.get(message.id)?.(message); } catch {}
    }
  });
  const request = (method: string, params: object) => new Promise<Reply>((done) => {
    waiting.set(++id, done);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "edu-bot-test", version: "0" } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const call = async (name: string, args: object) => {
    const reply = await request("tools/call", { name, arguments: args });
    return { ok: !reply.error && !reply.result?.isError, text: reply.result?.content?.[0]?.text ?? reply.error?.message ?? "" };
  };
  return { request, call, close: () => child.kill() };
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]);
}

describe.skipIf(!cli)("the installed Edu binary", () => {
  const dataDir = join(root, "data"), eduHome = join(root, "global");
  const brains = createEduBrains({ dataDir, config: () => ({ home: eduHome }), env: { ...process.env, OMB_EDU_CLI: cli! } });
  const bot = { id: "bot-real", name: "Luna" };

  it("serves a bot its own brain: notes land there, the brain cannot be switched, crew tools are absent", async () => {
    expect((await brains.detect()).state).toBe("ready");
    const server = await brains.integration(bot, { local: true });
    expect(server).not.toBeNull();
    const edu = await session(server!, { EDU_CREW_JOB: "" });
    try {
      const names = ((await edu.request("tools/list", {})).result?.tools ?? []).map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining(["edu_recall", "edu_remember", "edu_propose_canonical"]));
      expect(names.filter((name) => name.startsWith("edu_crew") || name === "edu_orchestrate")).toEqual([]);

      const remembered = await edu.call("edu_remember", { tier: "transitive", kind: "decision", band: "inferred", title: "Real binary note", body: "Stored by the Edu Bot test." });
      expect(remembered, remembered.text).toMatchObject({ ok: true });
      const brain = join(dataDir, "brains", bot.id, ".edu", "brain");
      const note = filesUnder(brain).find((file) => file.endsWith("real-binary-note.md"));
      expect(note).toBeDefined();
      expect(readFileSync(note!, "utf8")).toContain("Stored by the Edu Bot test.");
      expect((await edu.call("edu_recall", { query: "real binary note" })).text).toContain("Real binary note");

      const switched = await edu.call("edu_project_use", { workspace: "global" });
      expect(switched.ok).toBe(false);
      const proposed = await edu.call("edu_propose_canonical", { kind: "preference", title: "Real binary preference", body: "x" });
      expect(proposed.text).toContain("proposed");
    } finally {
      edu.close();
    }
  });

  it("refuses brain writes from a process that carries the crew-worker guard", async () => {
    const edu = await session((await brains.integration(bot, { local: true }))!, { EDU_CREW_JOB: `edu-bot:${bot.id}` });
    try {
      expect(await edu.call("edu_remember", { tier: "episodic", title: "Should not land", body: "x" })).toMatchObject({ ok: false });
      expect((await edu.call("edu_recall", { query: "real binary note" })).ok).toBe(true);
    } finally {
      edu.close();
    }
  });
});
