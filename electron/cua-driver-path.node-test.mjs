import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveDriver, stagedDevDriver } from "./cua-driver-path.mjs";

const APP = path.join(path.sep, "work", "edu-bot");
const RES = path.join(path.sep, "Applications", "Edu Bot.app", "Contents", "Resources");
const MAC_INSTALLED = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";
const resolve = (overrides, present = []) => resolveDriver({
  env: {}, packaged: false, platform: "darwin", arch: "arm64", resourcesPath: RES, appPath: APP, exists: (file) => present.includes(file), ...overrides,
});

test("a dev run on a Mac uses the driver dev:desktop staged, hosted by the app itself so there is something to grant permission to", () => {
  const staged = stagedDevDriver({ platform: "darwin", arch: "arm64", appPath: APP });
  assert.equal(staged, path.join(APP, "dist-native", "arm64", "cua-driver"));
  assert.deepEqual(resolve({}, [staged]), { binary: staged, embedded: true });
  assert.deepEqual(resolve({}, [staged, MAC_INSTALLED]), { binary: staged, embedded: true }, "ahead of a CuaDriver.app installed separately");
  assert.equal(resolve({ arch: "x64" }, [path.join(APP, "dist-native", "x64", "cua-driver")]).binary, path.join(APP, "dist-native", "x64", "cua-driver"));
});

test("a dev run on a Mac with nothing staged keeps attaching to an installed CuaDriver.app, and finds nothing where there is none", () => {
  assert.deepEqual(resolve({}, [MAC_INSTALLED]), { binary: MAC_INSTALLED, embedded: false });
  assert.deepEqual(resolve({ env: { OPENMAUSBOT_CUA_EMBEDDED: "1" } }, [MAC_INSTALLED]), { binary: MAC_INSTALLED, embedded: true });
  assert.deepEqual(resolve({}), { binary: null, embedded: false });
});

test("a dev run on Windows uses the staged driver, then one the person installed", () => {
  const staged = stagedDevDriver({ platform: "win32", arch: "x64", appPath: APP });
  const installed = path.join(path.sep, "Users", "ada", ".cua-driver", "packages", "current", "cua-driver.exe");
  assert.equal(staged, path.join(APP, "dist-native", "cua-win32-x64", "cua-driver.exe"));
  assert.deepEqual(resolve({ platform: "win32", arch: "x64", windowsInstalled: [installed] }, [staged, installed]), { binary: staged, embedded: true });
  assert.deepEqual(resolve({ platform: "win32", arch: "x64", windowsInstalled: [installed] }, [installed]), { binary: installed, embedded: true });
  assert.deepEqual(resolve({ platform: "win32", arch: "x64", windowsInstalled: [installed] }), { binary: null, embedded: true });
});

test("the packaged app keeps its own embedded driver and never looks in a source tree", () => {
  const bundled = path.join(RES, "cua-driver");
  const staged = stagedDevDriver({ platform: "darwin", arch: "arm64", appPath: APP });
  assert.deepEqual(resolve({ packaged: true }, [bundled, staged]), { binary: bundled, embedded: true });
  assert.deepEqual(resolve({ packaged: true }, [staged]), { binary: null, embedded: true });
  assert.deepEqual(resolve({ packaged: true, platform: "win32", arch: "x64" }, [path.join(RES, "cua-driver.exe")]), { binary: path.join(RES, "cua-driver.exe"), embedded: true });
});

test("CUA_DRIVER_PATH wins everywhere, and Linux stages nothing", () => {
  assert.deepEqual(resolve({ env: { CUA_DRIVER_PATH: "/opt/cua-driver" } }, [MAC_INSTALLED]), { binary: "/opt/cua-driver", embedded: false });
  assert.deepEqual(resolve({ env: { CUA_DRIVER_PATH: "/opt/cua-driver" }, packaged: true }), { binary: "/opt/cua-driver", embedded: true });
  assert.equal(stagedDevDriver({ platform: "linux", arch: "x64", appPath: APP }), null);
});
