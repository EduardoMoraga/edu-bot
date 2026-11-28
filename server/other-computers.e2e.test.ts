// A bot on the person's own computer is told how their other computers are reached, in the system prompt its engine
// receives. The fake engine holds the turn open so its launch record can be read.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { REMOTE_LOGIN_ADVICE } from "./other-computers.ts";

it("tells a bot on this computer to ask for one switch there, never a remote login, to reach another computer", async () => {
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "hang" });
  const control = (args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
  try {
    const { bot } = await control(["new-bot", "--name", "Clive"]);
    await control(["send", "--bot", bot.id, "--text", "List my herdr workspaces on my PC"]);
    await expect.poll(() => existsSync(fixture.fixtureDumpPath), { timeout: 30_000 }).toBe(true);
    const { systemPrompt } = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as { systemPrompt: string };
    rmSync(fixture.fixtureDumpPath, { force: true });
    await control(["interrupt", "--bot", bot.id]);
    expect(systemPrompt).toContain("never tell them to turn on SSH, OpenSSH Server, Remote Desktop or a firewall rule");
    expect(systemPrompt).toContain("Computadoras, Permitir siempre");
    expect(systemPrompt).not.toMatch(REMOTE_LOGIN_ADVICE);
  } finally {
    await fixture.close();
  }
}, 120_000);
