// Real end-to-end check against the locally installed `agy` CLI (`agy acp --stdio`).
// Skipped unless EDUBOT_ANTIGRAVITY_LIVE=1 (always skipped in CI).
// Isolates Edu Bot's data dir, HOME, and Edu CLI; shares ONLY the real `agy` executable path
// (and its existing Google login) with the Antigravity instance inside the fixture.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { runControlOmb, verificationServerEnvironment } from "../scripts/control-omb.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { hostTimeout } from "./testing/host-timeout.ts";
import { freePortBlock } from "./testing/ports.ts";

const LIVE = process.env.EDUBOT_ANTIGRAVITY_LIVE === "1";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FAKE_CLAUDE = join(ROOT, "server", "testing", "fake-claude-cli.ts");

function locateAgyCli(): string | null {
  const explicit = process.env.EDUBOT_ANTIGRAVITY_CLI?.trim();
  if (explicit && existsSync(explicit)) return explicit;
  const pathEnv = process.env.PATH ?? "";
  const names = process.platform === "win32" ? ["agy.exe", "agy.cmd", "agy"] : ["agy"];
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const agyCli = LIVE ? locateAgyCli() : null;
const skipReason = !LIVE
  ? "EDUBOT_ANTIGRAVITY_LIVE is not 1"
  : !agyCli
    ? "agy CLI was not found on PATH or EDUBOT_ANTIGRAVITY_CLI"
    : null;

describe.skipIf(skipReason !== null)(
  skipReason ? `Antigravity live e2e (skipped: ${skipReason})` : "Antigravity live e2e against real agy CLI",
  () => {
    let child: ChildProcess | undefined;
    let home = "";
    let base = "";
    let logPath = "";

    const control = (args: string[]) => runControlOmb([...args, "--url", base]) as Promise<any>;

    async function api(method: string, path: string, body?: unknown) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: { "content-type": "application/json", origin: base },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await response.text();
      return {
        status: response.status,
        body: text ? JSON.parse(text) as Record<string, any> : {},
      };
    }

    beforeAll(async () => {
      home = mkdtempSync(join(tmpdir(), "edubot-antigravity-live-"));
      mkdirSync(join(home, "tmp"), { recursive: true });
      const port = await freePortBlock([0, 1]);
      base = `http://127.0.0.1:${port}`;
      logPath = join(tmpdir(), `edubot-antigravity-live-${port}-${process.pid}.log`);
      writeFileSync(join(home, "config.json"), JSON.stringify({
        features: { smartSetupChoices: false },
        instances: {
          peer: {
            driver: "claudeAgent",
            displayName: "Fixture Peer",
            config: { cli: FAKE_CLAUDE },
          },
          antigravity: {
            driver: "antigravityAgent",
            displayName: "Google Gemini (Antigravity)",
            config: { cli: agyCli, fullAuto: true },
          },
        },
      }, null, 2));

      const env = verificationServerEnvironment({}, home, port);
      const log = openSync(logPath, "a", 0o600);
      try {
        child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server", "index.ts")], {
          cwd: ROOT,
          env,
          stdio: ["ignore", log, log],
        });
      } finally {
        closeSync(log);
      }

      await vi.waitFor(async () => {
        if (child?.exitCode !== null || child?.signalCode !== null) {
          throw new Error(`server exited early; log tail:\n${readFileSync(logPath, "utf8").slice(-2_000)}`);
        }
        const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1_500) });
        expect((await health.json() as { pid?: number }).pid).toBe(child!.pid);
      }, { timeout: 25_000, interval: 200 });
    }, hostTimeout(45_000));

    afterAll(async () => {
      await waitForExit(child, { signal: "SIGTERM" });
      if (home) await removeTempDir(home);
      if (logPath) rmSync(logPath, { force: true });
    });

    it("detects agy, refreshes Gemini models, replies OK, calls Edu Bot's agents MCP, and cancels a running turn", async () => {
      const refreshed = await api("POST", "/api/instances/antigravity/refresh-models", {});
      expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200);

      const list = await api("GET", "/api/instances");
      expect(list.status).toBe(200);
      const agy = (list.body.instances as Array<Record<string, any>>).find((row) => row.instanceId === "antigravity");
      expect(agy, "antigravity instance missing").toBeTruthy();
      expect(agy!.snapshot).toMatchObject({ state: "available", authenticated: true });

      const options = (agy!.models?.options ?? []) as Array<{ id: string; label: string; variants?: Array<{ id: string }> }>;
      const gemini = options.find((option) => option.id === "gemini-3.8-flash")
        ?? options.find((option) => option.id.startsWith("gemini-"));
      expect(gemini, `expected at least one gemini model, got ${JSON.stringify(options)}`).toBeTruthy();
      const lowVariant = gemini!.variants?.find((variant) => variant.id === "low")?.id;

      // Peer bot so the Antigravity bot can prove Edu Bot's agents MCP (`list_bots`).
      const peerBot = await api("POST", "/api/bots", {
        name: "Live Peer Sentinel",
        modelSelection: { instanceId: "peer", model: "claude-sonnet-4-6" },
      });
      expect(peerBot.status, JSON.stringify(peerBot.body)).toBe(201);

      const created = await api("POST", "/api/bots", {
        name: "Live Gemini Check",
        soul: "You are a concise assistant. Reply directly and briefly. Never search the web or call tools unless the user explicitly asks you to call a tool.",
        approvalMode: "full",
        modelSelection: { instanceId: "antigravity", model: gemini!.id, ...(lowVariant ? { variant: lowVariant } : {}) },
        requireAvailableModel: true,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const botId = created.body.bot.id as string;

      const readMessages = async () => {
        const res = await control(["messages", "--bot", botId, "--limit", "50"]);
        return (res.messages ?? []) as Array<Record<string, any>>;
      };

      // Turn 1: minimal prompt -> reply OK.
      const send1 = await control(["send", "--bot", botId, "--text", "Reply with the word OK."]);
      expect(send1.success, JSON.stringify(send1)).toBe(true);
      const wait1 = await control(["wait", "--bot", botId, "--timeout", "90"]);
      expect(wait1.status, JSON.stringify(wait1)).toBe("settled");
      const thread1 = await readMessages();
      const reply1 = thread1.filter((m) => m.role === "bot" && m.kind === "text").at(-1);
      expect(reply1?.text ?? "", JSON.stringify(thread1)).toMatch(/\bOK\b/i);

      // Turn 2: call Edu Bot's agents MCP (`list_bots`).
      const send2 = await control([
        "send", "--bot", botId,
        "--text", "Call the list_bots tool from the agents MCP server once, then reply with only the bot names it returned.",
      ]);
      expect(send2.success, JSON.stringify(send2)).toBe(true);
      const wait2 = await control(["wait", "--bot", botId, "--timeout", "90"]);
      expect(wait2.status, JSON.stringify(wait2)).toBe("settled");
      const thread2 = await readMessages();
      const newRows2 = thread2.slice(thread1.length);
      const reply2 = newRows2.filter((m) => m.role === "bot" && m.kind === "text").map((m) => String(m.text ?? "")).join("\n");
      const calledListBots = newRows2.some((m) => m.kind === "activity" && /list_bots/i.test(String(m.tool?.name ?? "")) && m.tool?.ok === true);
      expect(calledListBots, JSON.stringify(newRows2)).toBe(true);
      expect(reply2).toContain("Live Peer Sentinel");

      // Turn 3: cancel an active turn cleanly.
      const send3 = await control([
        "send", "--bot", botId,
        "--text", "Write the numbers 1 through 200, with a full paragraph describing each number in detail.",
      ]);
      expect(send3.success, JSON.stringify(send3)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const interrupted = await control(["interrupt", "--bot", botId]);
      expect(interrupted, JSON.stringify(interrupted)).toBeTruthy();
      const wait3 = await control(["wait", "--bot", botId, "--timeout", "45"]);
      expect(wait3.status, JSON.stringify(wait3)).toBe("settled");
      const thread3 = await readMessages();
      console.info(JSON.stringify({
        url: base,
        logPath,
        agyCli,
        model: gemini!.id,
        modelsCount: options.length,
        reply1: reply1?.text,
        calledListBots,
        reply2,
        cancelStatus: wait3.status,
        thread3Tail: thread3.slice(thread2.length).map((m) => ({ role: m.role, kind: m.kind, tool: m.tool?.name, textLen: String(m.text ?? "").length })),
      }));
    }, hostTimeout(240_000));
  },
);
