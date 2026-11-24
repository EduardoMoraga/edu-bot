// What `pnpm dev:desktop` needs before Electron starts: Electron's own download, and on macOS and Windows the
// cua-driver executable the packaged app ships, staged where a dev run looks for it (electron/cua-driver-path.mjs).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { stagedDevDriver } from "../electron/cua-driver-path.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Electron's download is there when `path.txt` names an executable that exists under `dist`. pnpm skips the download
 * when it is told not to run install scripts, and an interrupted one leaves no `path.txt`. */
export function electronReady(electronDir, { exists = existsSync, read = (file) => readFileSync(file, "utf8") } = {}) {
  const pathFile = path.join(electronDir, "path.txt");
  if (!exists(pathFile)) return false;
  const executable = read(pathFile).trim();
  return executable !== "" && exists(path.join(electronDir, "dist", executable));
}

/** Runs Electron's own installer when its download is missing. */
export function ensureElectron(electronDir, { run = runNode, log = console.log, ...probe } = {}) {
  if (electronReady(electronDir, probe)) return "ready";
  log("Electron is not downloaded yet. Downloading it now (about 100 MB, one time)…");
  const status = run(path.join(electronDir, "install.js"), { cwd: electronDir });
  if (status !== 0 || !electronReady(electronDir, probe)) {
    throw new Error(`Electron could not be downloaded. Check your connection, then run: node ${path.join(electronDir, "install.js")}`);
  }
  log("Electron is ready.");
  return "installed";
}

/** The script that stages this computer's driver, with its environment, or null when a dev run needs none or has it. */
export function driverStep({ platform, arch, root = ROOT, exists = existsSync }) {
  const staged = stagedDevDriver({ platform, arch, appPath: root });
  if (!staged || exists(staged)) return null;
  if (platform === "darwin") {
    return { script: path.join(root, "scripts", "prepare-cua.mjs"), env: { OPENMAUSBOT_CUA_ARCHES: arch, OPENMAUSBOT_CUA_ARCHES_PARTIAL: "1" } };
  }
  return arch === "x64" ? { script: path.join(root, "scripts", "prepare-cua-win.mjs"), env: {} } : null;
}

/** Stages the driver. A dev run still starts without it (offline, say): computer control says what is missing. */
export function ensureDriver(facts, { run = runNode, log = console.log, warn = console.warn } = {}) {
  const step = driverStep(facts);
  if (!step) return "ready";
  log("Getting the screen control driver (cua-driver) for this computer, one time…");
  if (run(step.script, { env: step.env }) === 0) return "staged";
  warn(`The screen control driver could not be prepared, so bots cannot use this computer in this run. To try again: node ${step.script}`);
  return "failed";
}

function runNode(script, { cwd = ROOT, env = {} } = {}) {
  return spawnSync(process.execPath, [script], { cwd, env: { ...process.env, ...env }, stdio: "inherit" }).status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const electronDir = path.dirname(createRequire(import.meta.url).resolve("electron/package.json"));
  ensureElectron(electronDir);
  ensureDriver({ platform: process.platform, arch: process.arch });
}
