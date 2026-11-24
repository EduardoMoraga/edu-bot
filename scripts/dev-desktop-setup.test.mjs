import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { driverStep, electronReady, ensureDriver, ensureElectron } from "./dev-desktop-setup.mjs";

let dir;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "dev-desktop-setup-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const download = (executable = "electron.exe") => {
  mkdirSync(path.join(dir, "dist"), { recursive: true });
  writeFileSync(path.join(dir, "dist", executable), "");
  writeFileSync(path.join(dir, "path.txt"), executable);
};

describe("Electron's download", () => {
  it("is missing with no path.txt, with an empty one, and with one that names a file that is not there", () => {
    expect(electronReady(dir)).toBe(false);
    writeFileSync(path.join(dir, "path.txt"), "");
    expect(electronReady(dir)).toBe(false);
    writeFileSync(path.join(dir, "path.txt"), "electron.exe");
    expect(electronReady(dir), "pnpm install that skipped the install script").toBe(false);
    download();
    expect(electronReady(dir)).toBe(true);
  });

  it("runs Electron's own install.js once when it is missing, and says so in plain words", () => {
    const log = vi.fn();
    const run = vi.fn((script, { cwd }) => { expect(script).toBe(path.join(dir, "install.js")); expect(cwd).toBe(dir); download(); return 0; });
    expect(ensureElectron(dir, { run, log })).toBe("installed");
    expect(run).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.map(([line]) => line)).toEqual(["Electron is not downloaded yet. Downloading it now (about 100 MB, one time)…", "Electron is ready."]);
    expect(ensureElectron(dir, { run, log })).toBe("ready");
    expect(run, "nothing to do the second time").toHaveBeenCalledTimes(1);
  });

  it("stops with the command to run when the download fails or leaves nothing", () => {
    expect(() => ensureElectron(dir, { run: () => 1, log: () => {} })).toThrow(/Electron could not be downloaded.*install\.js/s);
    expect(() => ensureElectron(dir, { run: () => 0, log: () => {} })).toThrow(/Electron could not be downloaded/);
  });
});

describe("the screen control driver for a dev run", () => {
  const root = path.join(path.sep, "work", "edu-bot");
  const none = () => false;

  it("is staged on a Mac for this Mac's own chip only, by the script the package uses", () => {
    expect(driverStep({ platform: "darwin", arch: "arm64", root, exists: none })).toEqual({
      script: path.join(root, "scripts", "prepare-cua.mjs"), env: { OPENMAUSBOT_CUA_ARCHES: "arm64", OPENMAUSBOT_CUA_ARCHES_PARTIAL: "1" },
    });
    expect(driverStep({ platform: "darwin", arch: "x64", root, exists: none })?.env.OPENMAUSBOT_CUA_ARCHES).toBe("x64");
  });

  it("is staged on Windows x64 by the script the package uses", () => {
    expect(driverStep({ platform: "win32", arch: "x64", root, exists: none })).toEqual({ script: path.join(root, "scripts", "prepare-cua-win.mjs"), env: {} });
    expect(driverStep({ platform: "win32", arch: "arm64", root, exists: none }), "no Windows arm64 driver is published").toBeNull();
  });

  it("is left alone once staged, and Linux needs none", () => {
    expect(driverStep({ platform: "darwin", arch: "arm64", root, exists: (file) => file === path.join(root, "dist-native", "arm64", "cua-driver") })).toBeNull();
    expect(driverStep({ platform: "win32", arch: "x64", root, exists: (file) => file === path.join(root, "dist-native", "cua-win32-x64", "cua-driver.exe") })).toBeNull();
    expect(driverStep({ platform: "linux", arch: "x64", root, exists: none })).toBeNull();
  });

  it("does not stop the dev run when it cannot be prepared: it warns with the command to try again", () => {
    const warn = vi.fn();
    const facts = { platform: "darwin", arch: "arm64", root, exists: none };
    expect(ensureDriver(facts, { run: () => 1, log: () => {}, warn })).toBe("failed");
    expect(warn.mock.calls[0][0]).toMatch(/bots cannot use this computer in this run.*prepare-cua\.mjs/s);
    const run = vi.fn(() => 0);
    expect(ensureDriver(facts, { run, log: () => {}, warn })).toBe("staged");
    expect(run).toHaveBeenCalledWith(path.join(root, "scripts", "prepare-cua.mjs"), { env: { OPENMAUSBOT_CUA_ARCHES: "arm64", OPENMAUSBOT_CUA_ARCHES_PARTIAL: "1" } });
    expect(ensureDriver({ ...facts, platform: "linux" }, { run: () => { throw new Error("not run"); } })).toBe("ready");
  });
});
