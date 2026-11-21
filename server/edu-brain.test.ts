import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { claudeEduMount, compareVersions, createEduBrains, eduBrainWidens, locateEduCli, parseEduBrainSetting, type EduConfig } from "./edu-brain.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const temps: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "edu-brain-")); temps.push(dir); return dir; };
afterEach(async () => { await Promise.all(temps.splice(0).map((dir) => removeTempDir(dir))); vi.restoreAllMocks(); });

describe("eduBrain setting", () => {
  it("accepts off, own and an absolute folder, and null as the default", () => {
    expect(parseEduBrainSetting({ mode: "off" })).toEqual({ ok: true, value: { mode: "off" } });
    expect(parseEduBrainSetting({ mode: "own", extra: 1 })).toEqual({ ok: true, value: { mode: "own" } });
    expect(parseEduBrainSetting(null)).toEqual({ ok: true, value: undefined });
    const folder = join(tmpdir(), "area", "..", "bi");
    expect(parseEduBrainSetting({ mode: "folder", path: ` ${folder} ` })).toEqual({ ok: true, value: { mode: "folder", path: join(tmpdir(), "bi") } });
  });

  it("refuses a relative or empty folder and unknown modes", () => {
    for (const value of [{ mode: "folder", path: "brains/bi" }, { mode: "folder", path: "" }, { mode: "folder" }, { mode: "global" }, "own", []]) {
      expect(parseEduBrainSetting(value).ok, JSON.stringify(value)).toBe(false);
    }
  });

  it("counts giving a brain or another folder as widening, never turning it off", () => {
    const folder = (path: string) => ({ mode: "folder" as const, path });
    expect(eduBrainWidens({ mode: "off" }, { mode: "own" })).toBe(true);
    expect(eduBrainWidens({ mode: "off" }, undefined)).toBe(true);
    expect(eduBrainWidens(undefined, folder("/a"))).toBe(true);
    expect(eduBrainWidens(folder("/a"), folder("/b"))).toBe(true);
    expect(eduBrainWidens(folder("/a"), folder("/a"))).toBe(false);
    expect(eduBrainWidens(folder("/a"), { mode: "own" })).toBe(false);
    expect(eduBrainWidens(undefined, { mode: "off" })).toBe(false);
  });

  it("compares versions numerically", () => {
    expect(compareVersions("6.0.0", "6.0.0")).toBe(0);
    expect(compareVersions("10.0.0", "6.0.0")).toBeGreaterThan(0);
    expect(compareVersions("5.9.12", "6.0.0")).toBeLessThan(0);
  });
});

describe("locateEduCli", () => {
  it.skipIf(process.platform === "win32")("follows npm's bin link to the script", () => {
    const prefix = temp();
    const script = join(prefix, "lib", "node_modules", "edu-agent", "dist", "cli.js");
    mkdirSync(join(script, ".."), { recursive: true });
    writeFileSync(script, "#!/usr/bin/env node\n");
    mkdirSync(join(prefix, "bin"));
    symlinkSync(script, join(prefix, "bin", "edu"));
    expect(locateEduCli({}, join(prefix, "bin"), "linux")).toBe(script);
  });

  it.skipIf(process.platform === "win32")("finds the package beside a shell wrapper", () => {
    const prefix = temp();
    const script = join(prefix, "lib", "node_modules", "edu-agent", "dist", "cli.js");
    mkdirSync(join(script, ".."), { recursive: true });
    writeFileSync(script, "");
    mkdirSync(join(prefix, "bin"));
    writeFileSync(join(prefix, "bin", "edu"), "#!/bin/sh\nexec mise x -- edu \"$@\"\n");
    chmodSync(join(prefix, "bin", "edu"), 0o755);
    expect(locateEduCli({}, [join(prefix, "missing"), join(prefix, "bin")].join(delimiter), "linux")).toBe(script);
  });

  it.skipIf(process.platform === "win32")("finds the package next to npm's Windows shim", () => {
    const prefix = temp();
    const script = join(prefix, "node_modules", "edu-agent", "dist", "cli.js");
    mkdirSync(join(script, ".."), { recursive: true });
    writeFileSync(script, "");
    writeFileSync(join(prefix, "edu"), "@ECHO off\n");
    expect(locateEduCli({}, prefix, "win32")).toBe(script);
  });

  it("takes OMB_EDU_CLI when it names an existing absolute file, and nothing else then", () => {
    const dir = temp();
    writeFileSync(join(dir, "cli.js"), "");
    expect(locateEduCli({ OMB_EDU_CLI: join(dir, "cli.js") }, "")).toBe(join(dir, "cli.js"));
    expect(locateEduCli({ OMB_EDU_CLI: join(dir, "gone.js") }, "")).toBeNull();
    expect(locateEduCli({ OMB_EDU_CLI: "cli.js" }, "")).toBeNull();
    expect(locateEduCli({}, join(dir, "empty"))).toBeNull();
  });
});

describe("createEduBrains", () => {
  const bot = { id: "b1", name: "Luna" };
  const setup = (options: { version?: string; fail?: boolean; cli?: string | null; config?: EduConfig; initMakesBrain?: boolean } = {}) => {
    const dataDir = temp();
    const calls: string[][] = [];
    let config: EduConfig | undefined = options.config;
    const brains = createEduBrains({
      dataDir,
      config: () => config,
      env: { HOME: dataDir },
      locate: () => options.cli === undefined ? "/opt/edu/cli.js" : options.cli,
      run: () => async (args) => {
        calls.push(args);
        if (options.fail) throw new Error("edu crashed");
        if (args[0] === "--version") return `${options.version ?? "6.0.0"}\n`;
        if (args.includes("init") && options.initMakesBrain !== false) mkdirSync(join(args[1]!, ".edu"), { recursive: true });
        return "";
      },
    });
    return { brains, dataDir, calls, setConfig: (next: EduConfig | undefined) => { config = next; } };
  };

  it("creates a bot's own brain once and mounts edu mcp locked to it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { brains, dataDir, calls } = setup();
    const [first, second] = await Promise.all([brains.integration(bot, { local: true }), brains.integration(bot, { local: true })]);
    const folder = join(dataDir, "brains", "b1");
    expect(first).toEqual({
      command: process.execPath,
      args: ["/opt/edu/cli.js", "--cwd", folder, "mcp", "--profile", "memory"],
      env: { ELECTRON_RUN_AS_NODE: "1", EDU_LOCK_WORKSPACE: "1", EDU_HOME: join(dataDir, ".edu") },
    });
    expect(second).toEqual(first);
    expect(calls.filter((args) => args.includes("init"))).toEqual([["--cwd", folder, "init", "--name", "Luna"]]);
    expect(await brains.status(bot)).toMatchObject({ state: "ready", mode: "own", brain: folder, version: "6.0.0" });
  });

  it("mounts nothing, and never throws, when Edu is missing, old, broken or off", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const [options, state] of [[{ cli: null }, "missing"], [{ version: "5.0.1" }, "old"], [{ fail: true }, "broken"],
      [{ config: { enabled: false } }, "off"], [{ config: { home: "relative/brain" } }, "broken"]] as const) {
      const { brains } = setup(options);
      expect(await brains.integration(bot, { local: true }), state).toBeNull();
      expect((await brains.status(bot)).state, JSON.stringify(options)).toBe(state);
    }
  });

  it("mounts nothing for a turn that does not run on this computer, or a bot with Edu off", async () => {
    const { brains, calls } = setup();
    expect(await brains.integration(bot, { local: false })).toBeNull();
    expect(await brains.integration({ ...bot, eduBrain: { mode: "off" } }, { local: true })).toBeNull();
    expect(calls.filter((args) => args.includes("init"))).toEqual([]);
    expect(await brains.status({ ...bot, eduBrain: { mode: "off" } })).toMatchObject({ state: "off", mode: "off" });
  });

  it("uses a shared folder only when it already holds a brain", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { brains, calls } = setup();
    const area = temp();
    const shared = { ...bot, eduBrain: { mode: "folder" as const, path: area } };
    expect(await brains.integration(shared, { local: true })).toBeNull();
    expect(await brains.status(shared)).toMatchObject({ state: "broken", mode: "folder", brain: area });
    mkdirSync(join(area, ".edu"));
    expect((await brains.integration(shared, { local: true }))?.args).toEqual(["/opt/edu/cli.js", "--cwd", area, "mcp", "--profile", "memory"]);
    expect(calls.filter((args) => args.includes("init"))).toEqual([]);
  });

  it("does not mount when edu init leaves no brain, which would write to the global one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { brains } = setup({ initMakesBrain: false });
    expect(await brains.integration(bot, { local: true })).toBeNull();
  });

  it("serves the configured global brain, ~ included", async () => {
    const { brains, dataDir, setConfig } = setup();
    setConfig({ home: "~/brains/global" });
    expect((await brains.integration(bot, { local: true }))?.env.EDU_HOME).toBe(join(dataDir, "brains", "global"));
  });
});

describe("claudeEduMount", () => {
  const edu = { command: "node", args: ["cli.js"], env: { EDU_LOCK_WORKSPACE: "1" } };

  it("guards the engine and clears the guard for the edu server only", () => {
    expect(claudeEduMount(edu, "b1", {})).toEqual({
      server: { ...edu, env: { EDU_LOCK_WORKSPACE: "1", EDU_CREW_JOB: "" } },
      engineEnv: { EDU_CREW_JOB: "edu-bot:b1" },
    });
  });

  it("keeps a guard Edu Bot inherited for both", () => {
    expect(claudeEduMount(edu, "b1", { EDU_CREW_JOB: "job-7" })).toEqual({ server: edu, engineEnv: {} });
  });
});
