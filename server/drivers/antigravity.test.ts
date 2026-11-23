import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, truncateSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DATA_DIR, ensureDirs } from "../config.ts";
import { TurnNotStartedError, type ProviderInstance } from "../contracts.ts";
import { recordEvents, type EventRecorder } from "../testing/events.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import * as procs from "../procs.ts";
import { botBox } from "../bot-box/box.ts";
import { dialRelay, openBoxRelay } from "../bot-box/relay.ts";
import * as envPath from "../env-path.ts";
import * as managedRuntime from "./antigravity-runtime.ts";
import {
  ANTIGRAVITY_AUTH_PREFIX,
  AntigravityAcpClient,
  antigravityProfileAuthenticated,
  antigravityProfileDirectory,
  authorizationUrlFromLine,
  catalogFromAntigravityConfigOptions,
  clearAntigravityCliAuth,
  isValidAntigravityInitializeResult,
  parseAntigravityAuthorizationUrl,
  prepareAntigravityProfile,
  probeAntigravityModels,
  validateAntigravityCallbackUrl,
  validateAntigravityRuntime,
} from "./antigravity-acp.ts";
import { AntigravityAuthController } from "./antigravity-auth.ts";
import {
  ANTIGRAVITY_RELEASE_VERSION,
  resolveAntigravityReleaseAsset,
  type AntigravityReleaseAsset,
} from "./antigravity-release.ts";
import {
  antigravityExecutablePath,
  antigravitySpawnArgs,
  clearAntigravityCliCacheForTests,
  cliProbeKey,
  installAntigravityRuntime,
  isAntigravityCli,
  isSupportedAntigravityCliVersion,
  prepareAntigravitySpawn,
  resolveAntigravityRuntime,
  verifyAntigravityCli,
} from "./antigravity-runtime.ts";
import * as antigravityTemp from "./antigravity-temp.ts";
import { VERIFICATION_TEMP_KEY, antigravityTempDir, sweepAntigravityTemp } from "./antigravity-temp.ts";
import {
  AntigravityDriver,
  STATIC_ANTIGRAVITY_MODELS,
  antigravityPermissionMode,
  normalizeAntigravityTurn,
} from "./antigravity.ts";

const FAKE_ACP = join(dirname(fileURLToPath(import.meta.url)), "..", "testing", "fake-acp-cli.ts");
const FAKE_SIGNIN = join(dirname(fileURLToPath(import.meta.url)), "..", "testing", "fake-antigravity-signin.ts");
const scratch: string[] = [];

function fakeRuntime(startupDelayMs = 0): { directory: string; executable: string; harness: string } {
  const directory = mkdtempSync(join(tmpdir(), "omb-antigravity-acp-"));
  scratch.push(directory);
  const executable = join(directory, "fake-antigravity.ts");
  const harness = join(directory, process.platform === "win32" ? "localharness_external.exe" : "localharness_external");
  copyFileSync(FAKE_ACP, executable);
  if (startupDelayMs) {
    writeFileSync(executable, `#!/usr/bin/env node\nsetTimeout(() => import(${JSON.stringify(pathToFileURL(FAKE_ACP).href)}), ${startupDelayMs});\n`);
  }
  copyFileSync(FAKE_ACP, harness);
  if (process.platform !== "win32") {
    chmodSync(executable, 0o755);
    chmodSync(harness, 0o755);
  }
  return { directory, executable, harness };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  clearAntigravityCliCacheForTests();
  clearAntigravityCliAuth();
  delete process.env.FAKE_ACP_AUTH_METHOD;
  delete process.env.FAKE_ACP_MODELS;
  delete process.env.FAKE_ACP_MODES;
  delete process.env.FAKE_ACP_DUMP;
  delete process.env.FAKE_ACP_PAD_QUESTION_OPTION;
  while (scratch.length) await removeTempDir(scratch.pop()!);
});

describe("official Antigravity catalog", () => {
  it("uses current Gemini 3.8 variants as the offline fallback", () => {
    expect(STATIC_ANTIGRAVITY_MODELS).toEqual({
      default: "gemini-3.8-flash",
      options: [
        {
          id: "gemini-3.8-flash",
          label: "Gemini 3.8 Flash",
          variants: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
          ],
        },
      ],
    });
  });

  it("reads the authenticated account catalog from ACP config options", () => {
    const options = [{
      id: "model",
      type: "select",
      currentValue: "account-low",
      options: [
        { value: "account-high", name: "Account High" },
        { group: "More", options: [{ value: "account-low", name: "Account Low" }] },
      ],
    }, {
      id: "thinking_level",
      category: "thought_level",
      type: "select",
      currentValue: "high",
      options: [
        { value: "low", name: "Low" },
        { value: "medium", name: "Medium" },
        { value: "high", name: "High" },
      ],
    }];
    expect(catalogFromAntigravityConfigOptions(options, "missing")).toEqual({
      default: "account-low",
      options: [
        { id: "account-high", label: "Account High" },
        {
          id: "account-low",
          label: "Account Low",
          variants: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
          ],
        },
      ],
    });
  });
});

describe("Antigravity sign-in lifecycle", () => {
  it("preserves failed setup errors until retry or external recovery, without reviving stale errors", async () => {
    if (!resolveAntigravityReleaseAsset()) return;
    const fake = fakeRuntime();
    const custom = join(fake.directory, "not-installed");
    const install = vi.spyOn(managedRuntime, "installAntigravityRuntime")
      .mockRejectedValueOnce(new Error("Antigravity initialization timed out: fixture failure"));
    const instance = await AntigravityDriver.create({
      instanceId: "failed-antigravity-install",
      displayName: "Antigravity fixture", enabled: true,
      config: { cli: custom, fullAuto: false },
      environment: {},
    });
    try {
      await expect(instance.installRuntime!()).rejects.toThrow("fixture failure");
      expect(await instance.snapshot()).toEqual({ state: "unavailable", reason: "Antigravity initialization timed out: fixture failure" });
      expect((await instance.snapshot()).reason).toContain("fixture failure");
      // A manual/shared install can recover without this instance retrying.
      copyFileSync(fake.executable, custom);
      if (process.platform !== "win32") chmodSync(custom, 0o755);
      expect((await instance.snapshot()).state).toBe("available");
      unlinkSync(custom);
      const unavailable = await instance.snapshot();
      expect(unavailable.state).toBe("unavailable");
      expect(unavailable.reason).not.toContain("fixture failure");
      install.mockRejectedValueOnce(new Error("Antigravity initialization timed out: fixture failure"));
      await expect(instance.installRuntime!()).rejects.toThrow("fixture failure");
      install.mockResolvedValueOnce({ executablePath: fake.executable, harnessPath: fake.harness, source: "managed", version: "1.1.1" });
      await instance.installRuntime!();
      expect((await instance.snapshot()).reason).not.toContain("fixture failure");
    } finally {
      await instance.dispose();
    }
  });

  it("signs out by forgetting only this account's stored Google sign-in", async () => {
    ensureDirs();
    const fake = fakeRuntime();
    const instanceId = "antigravity-sign-out";
    const profile = antigravityProfileDirectory(instanceId);
    const token = join(profile, "antigravity-acp", "acp_token.json");
    const other = join(antigravityProfileDirectory("antigravity-other"), "antigravity-acp", "acp_token.json");
    for (const file of [token, other]) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "{}", { mode: 0o600 });
    }
    const instance = await AntigravityDriver.create({
      instanceId, displayName: "Antigravity", enabled: true,
      config: { cli: fake.executable, fullAuto: false },
      environment: { FAKE_ACP_AUTH_METHOD: "oauth-personal" },
    });
    try {
      expect((await instance.snapshot()).authenticated).toBe(true);
      expect(instance.signOut).toBeTypeOf("function");
      await instance.signOut!();
      expect(existsSync(token)).toBe(false);
      expect(existsSync(join(profile, "antigravity-acp", "settings.json"))).toBe(true);
      expect(existsSync(other)).toBe(true);
      expect((await instance.snapshot()).authenticated).toBe(false);
      await instance.signOut!();
    } finally {
      await instance.dispose();
      await removeTempDir(profile);
      await removeTempDir(antigravityProfileDirectory("antigravity-other"));
    }
  });

  it("uses the same discovered PATH for readiness and Google sign-in", async () => {
    const fake = fakeRuntime();
    const executable = join(fake.directory, process.platform === "win32" ? "agy_acp_server.exe" : "agy_acp_server.par");
    copyFileSync(fake.executable, executable);
    if (process.platform !== "win32") chmodSync(executable, 0o755);
    vi.stubEnv("PATH", "");
    vi.spyOn(envPath, "augmentedPath").mockReturnValue(fake.directory);
    const authenticate = vi.spyOn(AntigravityAuthController.prototype, "start").mockResolvedValue({
      phase: "succeeded", flowId: null, authorizationUrl: null, expiresAt: null,
    });
    const instance = await AntigravityDriver.create({
      instanceId: "path-only-antigravity",
      displayName: "Antigravity fixture",
      enabled: true,
      config: { cli: "agy_acp_server" + (process.platform === "win32" ? ".exe" : ".par"), fullAuto: false },
      environment: { PATH: "" },
    });
    try {
      expect((await instance.snapshot()).state).toBe("available");
      await expect(instance.startAuthentication!()).resolves.toMatchObject({ phase: "succeeded" });
      expect(authenticate).toHaveBeenCalledWith(
        expect.objectContaining({ executablePath: executable }),
        expect.objectContaining({ environment: expect.objectContaining({ PATH: fake.directory }) }),
      );
    } finally {
      await instance.dispose();
    }
  });

  // Google's server announces the link on stderr, never stdout.
  it.each(["cancel", "provider failure"])("contains %s after handing the browser a sign-in URL", async (ending) => {
    const fake = fakeRuntime();
    const url = "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=fixture&redirect_uri=http%3A%2F%2F127.0.0.1%3A54321%2F";
    writeFileSync(fake.executable, `#!/usr/bin/env node
import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'authenticate') {
    console.error(${JSON.stringify(ANTIGRAVITY_AUTH_PREFIX + url)});
    ${ending === "provider failure" ? `setTimeout(() => console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -1, message: 'Sign-in expired' } })), 100);` : ""}
  } else console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }));
});
`);
    const runtime = await resolveAntigravityRuntime(fake.executable);
    const profile = await prepareAntigravityProfile({ instanceId: "auth-lifecycle", runtime, baseDir: fake.directory });
    const signedIn = vi.fn();
    const controller = new AntigravityAuthController(signedIn);
    try {
      const flow = await controller.start(runtime, profile);
      expect(flow.phase).toBe("waiting");
      if (ending === "cancel") controller.cancel();
      // Let rejected pending RPCs settle: Vitest must see no unhandled rejection.
      await new Promise((resolve) => setTimeout(resolve, 300));
      await expect(controller.complete(flow.flowId!, "http://127.0.0.1:54321/?code=test&state=fixture"))
        .rejects.toThrow(/no longer active/u);
      expect(signedIn).not.toHaveBeenCalled();
    } finally {
      controller.cancel();
    }
  });

  it("delivers a redirect pasted from another computer to the runtime's own callback listener, and the sign-in finishes", async () => {
    const fake = fakeRuntime();
    writeFileSync(fake.executable, readFileSync(FAKE_SIGNIN));
    const runtime = await resolveAntigravityRuntime(fake.executable);
    const profile = await prepareAntigravityProfile({ instanceId: "auth-pasted", runtime, baseDir: fake.directory });
    const signedIn = vi.fn();
    const controller = new AntigravityAuthController(signedIn);
    try {
      const flow = await controller.start(runtime, profile);
      const redirect = new URL(flow.authorizationUrl!).searchParams.get("redirect_uri")!;
      await controller.complete(flow.flowId!, `${redirect}?state=fixture&code=pasted`);
      expect(await antigravityProfileAuthenticated(profile)).toBe(true);
      expect(signedIn).toHaveBeenCalledOnce();
    } finally {
      controller.cancel();
    }
  });

  // A Cloud home runs the runtime in a bot box with its own network, where only the box's relay reaches its listener
  // (proved against a real box in antigravity-box.linux.test.ts); here the relay's box side runs in this process.
  it.skipIf(process.platform === "win32")("delivers the redirect through the box's relay when sign-in runs in a bot box, and closes the relay after", async () => {
    const fake = fakeRuntime();
    writeFileSync(fake.executable, readFileSync(FAKE_SIGNIN));
    const runtime = await resolveAntigravityRuntime(fake.executable);
    const profile = await prepareAntigravityProfile({ instanceId: "auth-relayed", runtime, baseDir: fake.directory });
    const relay = await openBoxRelay(join(fake.directory, "relay.sock"));
    const inBox = dialRelay(relay.socketPath, 20);
    const reach = vi.spyOn(relay, "connect");
    vi.spyOn(botBox, "openRelay").mockResolvedValue(relay);
    const spawned = vi.spyOn(procs, "spawnCli");
    const controller = new AntigravityAuthController();
    try {
      const flow = await controller.start(runtime, profile);
      expect(spawned.mock.calls[0]![2]).toMatchObject({ box: { relay: relay.socketPath } });
      const redirect = new URL(new URL(flow.authorizationUrl!).searchParams.get("redirect_uri")!);
      await controller.complete(flow.flowId!, `${redirect.href}?state=fixture&code=pasted`);
      expect(reach).toHaveBeenCalledWith(Number(redirect.port));
      expect(await antigravityProfileAuthenticated(profile)).toBe(true);
      await vi.waitFor(() => expect(existsSync(relay.socketPath)).toBe(false));
    } finally {
      controller.cancel();
      inBox.close();
      relay.close();
    }
  });

  it("reports a sign-in Google finishes on its own, so the account's models are read", async () => {
    const fake = fakeRuntime();
    const url = "https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=fixture&redirect_uri=http%3A%2F%2F127.0.0.1%3A54321%2F";
    writeFileSync(fake.executable, `#!/usr/bin/env node
import { createInterface } from 'node:readline';
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'authenticate') {
    console.error(${JSON.stringify(ANTIGRAVITY_AUTH_PREFIX + url)});
    setTimeout(() => console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} })), 100);
  } else console.log(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }));
});
`);
    const runtime = await resolveAntigravityRuntime(fake.executable);
    const profile = await prepareAntigravityProfile({ instanceId: "auth-finishes", runtime, baseDir: fake.directory });
    let signedIn!: () => void;
    const reported = new Promise<void>((resolve) => { signedIn = resolve; });
    const controller = new AntigravityAuthController(() => signedIn());
    try {
      expect((await controller.start(runtime, profile)).phase).toBe("waiting");
      await expect(reported).resolves.toBeUndefined();
    } finally {
      controller.cancel();
    }
  });
});

describe("stopping the runtime before touching its files", () => {
  it.skipIf(process.platform === "win32")("waits through forced shutdown when the verified runtime ignores EOF and TERM", async () => {
    const fake = fakeRuntime();
    // Stays up after its input ends, so close() must go on to force it.
    writeFileSync(fake.executable, `#!/usr/bin/env node\nprocess.on('SIGTERM', () => {});\nsetInterval(() => {}, 1 << 30);\nawait import(${JSON.stringify(pathToFileURL(FAKE_ACP).href)});\n`);
    const runtime = await resolveAntigravityRuntime(fake.executable);
    vi.stubEnv("FAKE_ACP_AGENT_NAME", "Google Antigravity");
    vi.stubEnv("FAKE_ACP_AGENT_VERSION", "1.1.1");
    vi.stubEnv("FAKE_ACP_AUTH_METHOD", "oauth-personal");
    const spawned = vi.spyOn(procs, "spawnCli");
    try {
      await expect(validateAntigravityRuntime(runtime, "agy_acp_server_1.1.1")).resolves.toBeUndefined();
      expect(spawned.mock.results[0]!.value.signalCode).toBe("SIGKILL");
    } finally {
      await Promise.all(spawned.mock.results.map(({ value }) => procs.killCliTree(value, 0)));
    }
  }, 20_000);

  it("ends the runtime's input and lets it exit by itself before any forced stop", async () => {
    // On Windows a forced stop skips the runtime's cleanup of what it unpacked; its own exit removes them.
    const fake = fakeRuntime();
    const runtime = await resolveAntigravityRuntime(fake.executable);
    const profile = await prepareAntigravityProfile({ instanceId: "graceful-close", runtime, baseDir: fake.directory });
    const client = new AntigravityAcpClient(runtime, profile, fake.directory);
    await client.initialize();
    const kill = vi.spyOn(procs, "killCliTree");
    client.close();
    expect(client.child.stdin?.writableEnded).toBe(true);
    expect(kill).not.toHaveBeenCalled();
    expect(await client.closeAndWait()).toBe(true);
    // Exit code 0 and no signal: not SIGTERM (POSIX) and not taskkill's 1.
    expect(client.child.exitCode).toBe(0);
    expect(client.child.signalCode).toBeNull();
  });

  it("validates a real fake runtime and waits for its process to close before returning", async () => {
    const fake = fakeRuntime();
    const runtime = await resolveAntigravityRuntime(fake.executable);
    vi.stubEnv("FAKE_ACP_AGENT_NAME", "Google Antigravity");
    vi.stubEnv("FAKE_ACP_AGENT_VERSION", "1.1.1");
    vi.stubEnv("FAKE_ACP_AUTH_METHOD", "oauth-personal");
    let sawClose = false;
    const spawn = procs.spawnCli;
    const spawned = vi.spyOn(procs, "spawnCli").mockImplementation((...args) => {
      const child = spawn(...args);
      child.once("close", () => { sawClose = true; });
      return child;
    });
    await validateAntigravityRuntime(runtime, "agy_acp_server_1.1.1");
    expect(spawned).toHaveBeenCalledTimes(1);
    expect(sawClose).toBe(true);
    const child = spawned.mock.results[0]!.value;
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });

  it("closeAndWait resolves only once the process is gone, so a rename on Windows cannot hit a running executable", async () => {
    const fake = fakeRuntime();
    const runtime = await resolveAntigravityRuntime(fake.executable);
    const profile = await prepareAntigravityProfile({ instanceId: "close-and-wait", runtime, baseDir: fake.directory });
    const client = new AntigravityAcpClient(runtime, profile, fake.directory);
    await client.initialize();
    expect(client.child.exitCode).toBeNull();
    expect(await client.closeAndWait()).toBe(true);
    expect(client.child.exitCode !== null || client.child.signalCode !== null).toBe(true);
    expect(await client.closeAndWait(100)).toBe(true);
  });
});

describe("official Antigravity runtime", () => {
  it("pins Google's release metadata for this supported host", () => {
    const asset = resolveAntigravityReleaseAsset();
    if (!asset) return;
    expect(ANTIGRAVITY_RELEASE_VERSION).toBe("1.4.3");
    expect(asset.version).toBe(ANTIGRAVITY_RELEASE_VERSION);
    expect(asset.url).toMatch(/^https:\/\/dl\.google\.com\/agy-extensions\/releases\//u);
    expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(asset.archiveBytes).toBeGreaterThan(100_000_000);
  });

  it("publishes Google's official runtime for Intel Macs like the other Mac and PC builds", () => {
    const intelMac = resolveAntigravityReleaseAsset("darwin", "x64");
    expect(intelMac).toMatchObject({
      version: ANTIGRAVITY_RELEASE_VERSION,
      url: "https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-1.4.3-darwin-x86_64.zip",
      sha256: "9392dbbdad7f0663dbfb5a0bf641297b0cf80d2ee9cd2d49a616bbbc7378731d",
      archiveBytes: 119_801_100,
    });
    expect(intelMac?.executable.name).toBe(resolveAntigravityReleaseAsset("darwin", "arm64")?.executable.name);
    expect(intelMac?.harness.name).toBe(resolveAntigravityReleaseAsset("darwin", "arm64")?.harness.name);
  });

  function testValidatesAcpInitializeResults() {
    const basePayload = {
      protocolVersion: 1,
      agentInfo: { name: "antigravity-acp", version: "1.1.1" },
      agentCapabilities: {
        loadSession: true,
        sessionCapabilities: { resume: true },
        auth: { logout: true },
      },
      authMethods: [{ id: "oauth-personal" }],
    };

    expect(isValidAntigravityInitializeResult(basePayload, "agy_acp_server_1.1.1")).toBe(true);
    expect(isValidAntigravityInitializeResult(basePayload, "1.1.1")).toBe(true);

    expect(isValidAntigravityInitializeResult({
      ...basePayload,
      agentInfo: { name: "antigravity-acp", version: "agy_acp_server_1.1.1" },
    }, "agy_acp_server_1.1.1")).toBe(true);

    expect(isValidAntigravityInitializeResult({
      ...basePayload,
      agentInfo: { name: "Google Antigravity", version: "1.1.1" },
    }, "agy_acp_server_1.1.1")).toBe(true);

    expect(isValidAntigravityInitializeResult({ ...basePayload, protocolVersion: 2 }, "1.1.1")).toBe(false);

    expect(isValidAntigravityInitializeResult({
      ...basePayload,
      agentInfo: { name: "rogue-agent", version: "1.1.1" },
    }, "1.1.1")).toBe(false);

    expect(isValidAntigravityInitializeResult({
      ...basePayload,
      agentInfo: { name: "antigravity-acp", version: "2.0.0" },
    }, "1.1.1")).toBe(false);

    expect(isValidAntigravityInitializeResult({
      ...basePayload,
      agentCapabilities: { loadSession: false, sessionCapabilities: { resume: true }, auth: { logout: true } },
    }, "1.1.1")).toBe(false);

    expect(isValidAntigravityInitializeResult({
      ...basePayload,
      authMethods: [{ id: "api-key" }],
    }, "1.1.1")).toBe(false);

    expect(isValidAntigravityInitializeResult({
      ...basePayload,
      agentInfo: { name: "antigravity-acp", version: 1 },
    }, "1.1.1")).toBe(false);
    expect(isValidAntigravityInitializeResult({
      ...basePayload,
      agentInfo: { name: "antigravity-acp", version: null },
    }, "1.1.1")).toBe(false);

    expect(isValidAntigravityInitializeResult(null, "1.1.1")).toBe(false);
    expect(isValidAntigravityInitializeResult(undefined, "1.1.1")).toBe(false);
  }

  it("validates ACP initialize results from official Antigravity releases", testValidatesAcpInitializeResults);

  // Captured from the SHA-256-pinned Google 1.4.3 Windows x64 binary, unauthenticated: optional operations are objects.
  const officialInitialize = {
    protocolVersion: 1,
    agentInfo: { name: "antigravity-acp", title: "Google Antigravity", version: "1.4.3" },
    agentCapabilities: {
      loadSession: true,
      sessionCapabilities: { list: {}, resume: {} },
      auth: { logout: {} },
    },
    authMethods: [{ id: "oauth-personal", name: "Log in with Google" }],
  };

  it("accepts the official runtime's object-shaped capabilities", () => {
    expect(isValidAntigravityInitializeResult(officialInitialize, ANTIGRAVITY_RELEASE_VERSION)).toBe(true);
  });

  it.each([undefined, null, false, [], "true", 1])("rejects malformed operation capabilities: %j", (value) => {
    for (const capabilities of [
      { ...officialInitialize.agentCapabilities, sessionCapabilities: { resume: value } },
      { ...officialInitialize.agentCapabilities, auth: { logout: value } },
    ]) {
      expect(isValidAntigravityInitializeResult({ ...officialInitialize, agentCapabilities: capabilities }, ANTIGRAVITY_RELEASE_VERSION)).toBe(false);
    }
  });

  it("requires the official executable and harness as a pair", async () => {
    const fake = fakeRuntime();
    await expect(resolveAntigravityRuntime(fake.executable)).resolves.toMatchObject({
      executablePath: fake.executable,
      harnessPath: fake.harness,
      source: "override",
    });
    rmSync(fake.harness, { force: true });
    await expect(resolveAntigravityRuntime(fake.executable)).rejects.toMatchObject({
      message: expect.stringMatching(/localharness_external/u),
      status: 409,
    });
  });

  it.each([
    undefined,
    "agy",
  ])("resolves the default command %s to the official runtime on PATH when no v1.5+ agy is present", async (defaultCommand) => {
    const fake = fakeRuntime();
    const officialExecutable = join(fake.directory, process.platform === "win32" ? "agy_acp_server.exe" : "agy_acp_server.par");
    copyFileSync(fake.executable, officialExecutable);
    if (process.platform !== "win32") chmodSync(officialExecutable, 0o755);
    const runtime = await resolveAntigravityRuntime(defaultCommand, { PATH: fake.directory }, fake.directory);
    expect(runtime).toMatchObject({ executablePath: officialExecutable, source: "path" });
  });

  it.each([
    "agy.cmd",
    "C:\\Users\\Someone\\AppData\\Roaming\\npm\\agy.cmd",
    "C:\\Tools\\agy.exe",
    "C:\\Tools\\agy.bat",
    "C:\\Tools\\agy.ps1",
    "/opt/homebrew/bin/agy",
    "/Users/someone/.local/bin/agy",
  ])("refuses to replace an explicit agy override %s with another binary on PATH", async (explicitPath) => {
    const fake = fakeRuntime();
    const officialExecutable = join(fake.directory, process.platform === "win32" ? "agy_acp_server.exe" : "agy_acp_server.par");
    copyFileSync(fake.executable, officialExecutable);
    if (process.platform !== "win32") chmodSync(officialExecutable, 0o755);
    await expect(resolveAntigravityRuntime(explicitPath, { PATH: fake.directory }, fake.directory))
      .rejects.toMatchObject({ status: 409 });
  });

  it("explains the official setup when a legacy CLI has no replacement installed", async () => {
    if (!resolveAntigravityReleaseAsset()) return;
    const fake = fakeRuntime();
    await expect(resolveAntigravityRuntime("/old/bin/agy", { PATH: "" }, fake.directory))
      .rejects.toThrow(/Install official Antigravity, then Sign in with Google/);
  });

  it("preserves a valid explicitly selected official runtime even if named agy", async () => {
    const fake = fakeRuntime();
    const custom = join(fake.directory, "agy");
    copyFileSync(fake.executable, custom);
    if (process.platform !== "win32") chmodSync(custom, 0o755);
    await expect(resolveAntigravityRuntime(custom, { PATH: "" }, fake.directory))
      .resolves.toMatchObject({ executablePath: custom, source: "override" });
  });

  it("does not silently replace an unrecognized custom executable", async () => {
    const fake = fakeRuntime();
    await expect(resolveAntigravityRuntime(join(fake.directory, "custom-acp"), { PATH: "" }, fake.directory))
      .rejects.toThrow(/custom Antigravity ACP executable/);
  });

  it("atomically prepares one complete profile for concurrent callers", async () => {
    const fake = fakeRuntime();
    const runtime = await resolveAntigravityRuntime(fake.executable);
    const profileDirectory = join(fake.directory, "profile");
    await Promise.all(Array.from({ length: 8 }, () => prepareAntigravityProfile({
      instanceId: "shared",
      runtime,
      baseEnv: {},
      profileDirectory,
    })));
    const acpDirectory = join(profileDirectory, "antigravity-acp");
    expect(JSON.parse(readFileSync(join(acpDirectory, "settings.json"), "utf8"))).toEqual({
      auth: { type: "oauth-personal" },
    });
    expect(readdirSync(acpDirectory).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses a symlinked staging root before launching a profile process", async () => {
    const fake = fakeRuntime();
    const runtime = await resolveAntigravityRuntime(fake.executable);
    const profileDirectory = join(fake.directory, "profile");
    const outside = join(fake.directory, "outside");
    mkdirSync(profileDirectory);
    mkdirSync(outside);
    symlinkSync(outside, join(profileDirectory, "omb-skills"), process.platform === "win32" ? "junction" : "dir");
    await expect(prepareAntigravityProfile({ instanceId: "linked-staging", runtime, baseEnv: {}, profileDirectory }))
      .rejects.toThrow("Antigravity staging path must be a real directory.");
    expect(readdirSync(outside)).toEqual([]);
  });

  it("keeps the existing Google sign-in when the runtime version changes", async () => {
    const fake = fakeRuntime();
    const runtime = await resolveAntigravityRuntime(fake.executable);
    const input = { instanceId: "persistent", runtime, baseEnv: {}, baseDir: fake.directory };
    const before = await prepareAntigravityProfile(input);
    writeFileSync(before.tokenPath, '{"fixture":"existing-login"}', { mode: 0o600 });
    const after = await prepareAntigravityProfile({ ...input, runtime: { ...runtime, version: "new-version" } });
    expect(after.tokenPath).toBe(before.tokenPath);
    expect(readFileSync(after.tokenPath, "utf8")).toBe('{"fixture":"existing-login"}');
    expect(await antigravityProfileAuthenticated(after)).toBe(true);
  });

  it("discovers account models when the packaged runtime takes over five seconds to start", async () => {
    const fake = fakeRuntime(5_500);
    const runtime = await resolveAntigravityRuntime(fake.executable);
    const profile = await prepareAntigravityProfile({
      instanceId: "slow-start", runtime, baseDir: fake.directory,
      baseEnv: { PATH: process.env.PATH, FAKE_ACP_AUTH_METHOD: "oauth-personal", FAKE_ACP_MODELS: "account-model" },
    });
    await expect(probeAntigravityModels({ runtime, profile, fallbackDefault: "account-model" }))
      .resolves.toMatchObject({ options: [{ id: "account-model" }] });
  }, 20_000);

  it("discovers thinking levels for every account model, not only the one a new session starts on", async () => {
    const fake = fakeRuntime();
    const runtime = await resolveAntigravityRuntime(fake.executable);
    const levels = [{ value: "low", name: "Low" }, { value: "high", name: "High" }];
    const profile = await prepareAntigravityProfile({
      instanceId: "thinking-levels", runtime, baseDir: fake.directory,
      baseEnv: {
        PATH: process.env.PATH,
        FAKE_ACP_AUTH_METHOD: "oauth-personal",
        FAKE_ACP_MODELS: "gemini-flash,gemini-argon,gemini-plain",
        FAKE_ACP_VARIANTS: JSON.stringify({
          "gemini-flash": { id: "thought_level", currentValue: "low", options: levels },
          "gemini-argon": { id: "thought_level", currentValue: "high", options: levels },
        }),
      },
    });
    const variants = [{ id: "low", label: "Low" }, { id: "high", label: "High" }];
    await expect(probeAntigravityModels({ runtime, profile, fallbackDefault: "gemini-flash" })).resolves.toEqual({
      default: "gemini-flash",
      options: [
        { id: "gemini-flash", label: "gemini-flash", variants },
        { id: "gemini-argon", label: "gemini-argon", variants },
        { id: "gemini-plain", label: "gemini-plain" },
      ],
    });
  }, 20_000);

  it("rejects a download redirected to insecure HTTP", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "omb-antigravity-insecure-"));
    scratch.push(baseDir);
    const asset: AntigravityReleaseAsset = {
      version: "insecure-test",
      url: "https://dl.google.com/test-antigravity.zip",
      sha256: "00".repeat(32),
      archiveBytes: 1,
      executable: { name: "agy_acp_server.par", bytes: 1 },
      harness: { name: "localharness_external", bytes: 1 },
    };
    const response = new Response(new Uint8Array([0]), { headers: { "content-length": "1" } });
    Object.defineProperty(response, "url", { value: "http://dl.google.com/test-antigravity.zip" });
    await expect(installAntigravityRuntime({
      baseDir,
      asset,
      fetchImpl: async () => response,
    })).rejects.toThrow(/redirected outside/u);
  });

  it("coalesces, verifies, extracts, and reuses a pinned download without touching another install", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "omb-antigravity-install-"));
    scratch.push(baseDir);
    const versions = join(baseDir, "tools", "antigravity-acp", `${process.platform}-${process.arch}`, "versions");
    const otherStaging = join(versions, ".install-other-active", "runtime");
    mkdirSync(otherStaging, { recursive: true });
    const otherFile = join(otherStaging, "agy_acp_server.exe");
    writeFileSync(otherFile, "another app process is still installing");
    const archive = Buffer.from(
      "UEsDBBQAAAAIAMaAI13ihkXDEwAAABEAAAASAAAAYWd5X2FjcF9zZXJ2ZXIucGFyU1bUT8rM0y/O4EqtyCxRMOACAFBLAwQUAAAACADGgCNd4oZFwxMAAAARAAAAFQAAAGxvY2FsaGFybmVzc19leHRlcm5hbFNW1E/KzNMvzuBKrcgsUTDgAgBQSwECFAMUAAAACADGgCNd4oZFwxMAAAARAAAAEgAAAAAAAAAAAAAAgAEAAAAAYWd5X2FjcF9zZXJ2ZXIucGFyUEsBAhQDFAAAAAgAxoAjXeKGRcMTAAAAEQAAABUAAAAAAAAAAAAAAIABQwAAAGxvY2FsaGFybmVzc19leHRlcm5hbFBLBQYAAAAAAgACAIMAAACJAAAAAAA=",
      "base64",
    );
    const asset: AntigravityReleaseAsset = {
      version: "test-release",
      url: "https://dl.google.com/test-antigravity.zip",
      sha256: "ebefcc10b5101013da6d0cb2a101ca644015377ee0f9ec5cf4efec7d9dfb7442",
      archiveBytes: archive.length,
      executable: { name: "agy_acp_server.par", bytes: 17 },
      harness: { name: "localharness_external", bytes: 17 },
    };
    let fetches = 0;
    let validations = 0;
    const options = {
      baseDir,
      asset,
      fetchImpl: async () => {
        fetches += 1;
        return new Response(archive, { headers: { "content-length": String(archive.length) } });
      },
      validate: async () => { validations += 1; },
    };
    const first = installAntigravityRuntime(options);
    expect(installAntigravityRuntime(options)).toBe(first);
    const installed = await first;
    expect(readFileSync(installed.executablePath, "utf8")).toBe("#!/bin/sh\nexit 0\n");
    expect(readFileSync(installed.harnessPath, "utf8")).toBe("#!/bin/sh\nexit 0\n");
    await installAntigravityRuntime(options);
    expect(fetches).toBe(1);
    expect(validations).toBe(2);
    expect(readFileSync(otherFile, "utf8")).toBe("another app process is still installing");
    expect(readdirSync(versions).filter((name) => name.startsWith(".install-"))).toEqual([".install-other-active"]);
  });

  it("isolates profiles by instance and strips ambient Google credentials", async () => {
    const fake = fakeRuntime();
    const runtime = await resolveAntigravityRuntime(fake.executable);
    const first = await prepareAntigravityProfile({
      instanceId: "work",
      runtime,
      baseEnv: { HOME: "/tmp/home", GEMINI_API_KEY: "must-not-leak", GOOGLE_API_KEY: "also-no" },
    });
    const second = await prepareAntigravityProfile({ instanceId: "personal", runtime, baseEnv: {} });
    expect(first.directory).not.toBe(second.directory);
    expect(first.environment.GEMINI_API_KEY).toBeUndefined();
    expect(first.environment.GOOGLE_API_KEY).toBeUndefined();
    expect(first.environment.GEMINI_HOME).toBe(first.directory);
    expect(first.environment.ANTIGRAVITY_HARNESS_PATH).toBe(fake.harness);
  });

  it("points TEMP on Windows at one stable folder per instance under DATA_DIR/tmp", async () => {
    const fake = fakeRuntime();
    const runtime = await resolveAntigravityRuntime(fake.executable);
    const input = {
      instanceId: "work",
      runtime,
      baseDir: fake.directory,
      platform: "win32" as const,
      baseEnv: { Temp: "C:\\Users\\ada\\AppData\\Local\\Temp", tmp: "C:\\Temp", PATH: process.env.PATH },
    };
    const first = await prepareAntigravityProfile(input);
    const again = await prepareAntigravityProfile(input);
    const expected = antigravityTempDir(fake.directory, "work");
    expect(first.tempDirectory).toBe(expected);
    expect(first.environment.TEMP).toBe(expected);
    expect(first.environment.TMP).toBe(expected);
    expect(Object.keys(first.environment).filter((key) => /^(?:temp|tmp)$/iu.test(key)).sort()).toEqual(["TEMP", "TMP"]);
    expect(statSync(expected).isDirectory()).toBe(true);
    expect(again.environment).toEqual(first.environment);
    expect(expected.startsWith(join(fake.directory, "tmp", "agy"))).toBe(true);
    expect(expected.startsWith(first.directory)).toBe(false);
    const other = await prepareAntigravityProfile({ ...input, instanceId: "personal" });
    expect(other.environment.TEMP).not.toBe(expected);
  });

  it("leaves TEMP alone on macOS and Linux", async () => {
    const fake = fakeRuntime();
    const runtime = await resolveAntigravityRuntime(fake.executable);
    for (const platform of ["darwin", "linux"] as const) {
      const profile = await prepareAntigravityProfile({
        instanceId: "work", runtime, baseDir: fake.directory, platform, baseEnv: { TEMP: "/inherited", TMPDIR: "/inherited-dir" },
      });
      expect(profile.tempDirectory).toBeUndefined();
      expect(profile.environment.TEMP).toBe("/inherited");
      expect(profile.environment.TMPDIR).toBe("/inherited-dir");
    }
    expect(existsSync(join(fake.directory, "tmp"))).toBe(false);
  });

  it("clears what an earlier run of this instance left behind when the driver starts", async () => {
    ensureDirs();
    const instanceId = "antigravity-leftovers";
    // Owned by an ID no process can have, so it is certainly abandoned.
    const abandoned = join(antigravityTempDir(DATA_DIR, instanceId), `_MEI7ffffff02`);
    // And one a runtime verification left when its runtime would not stop.
    const verification = join(antigravityTempDir(DATA_DIR, VERIFICATION_TEMP_KEY), `_MEI7ffffff03`);
    for (const folder of [abandoned, verification]) {
      mkdirSync(join(folder, "google3"), { recursive: true });
      writeFileSync(join(folder, "google3", "payload.bin"), "unpacked");
    }
    const scheduled = vi.spyOn(antigravityTemp, "scheduleAntigravityTempSweep");
    const instance = await AntigravityDriver.create({
      instanceId,
      displayName: "Antigravity fixture",
      enabled: true,
      config: { cli: join(DATA_DIR, "not-installed"), fullAuto: false },
      environment: {},
    });
    try {
      expect(scheduled).toHaveBeenCalledWith(instanceId);
      expect(scheduled).toHaveBeenCalledWith(VERIFICATION_TEMP_KEY);
      await sweepAntigravityTemp(instanceId);
      await sweepAntigravityTemp(VERIFICATION_TEMP_KEY);
      expect(existsSync(abandoned)).toBe(false);
      expect(existsSync(verification)).toBe(false);
    } finally {
      await instance.dispose();
    }
  });

  it("bounds model discovery with one deadline", async () => {
    const fake = fakeRuntime();
    const runtime = await resolveAntigravityRuntime(fake.executable);
    const profile = await prepareAntigravityProfile({
      instanceId: "slow-models",
      runtime,
      baseEnv: { ...process.env, FAKE_ACP_MODE: "hang-initialize" },
    });
    const started = Date.now();
    await expect(probeAntigravityModels({
      runtime,
      profile,
      fallbackDefault: STATIC_ANTIGRAVITY_MODELS.default,
      timeoutMs: 100,
    })).rejects.toThrow(/timed out/u);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("Antigravity OAuth validation", () => {
  const state = "state-123";
  const redirectUri = "http://127.0.0.1:8765/";
  const authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;

  it("accepts only Google's exact loopback authorization request", () => {
    expect(ANTIGRAVITY_AUTH_PREFIX).toContain("authenticate the ACP server");
    expect(parseAntigravityAuthorizationUrl(authorizationUrl)).toEqual({ authorizationUrl, redirectUri, state });
    expect(() => parseAntigravityAuthorizationUrl(authorizationUrl.replace("accounts.google.com", "example.com"))).toThrow(/invalid/u);
    expect(() => parseAntigravityAuthorizationUrl(authorizationUrl.replace("127.0.0.1", "localhost"))).toThrow(/invalid/u);
  });

  it("reads the sign-in link from either announcement Google makes", () => {
    expect(authorizationUrlFromLine(`__OPENMAUS_ANTIGRAVITY_AUTH_URL__${JSON.stringify(authorizationUrl)}`))
      .toBe(authorizationUrl);
    expect(authorizationUrlFromLine(`${ANTIGRAVITY_AUTH_PREFIX}${authorizationUrl}`)).toBe(authorizationUrl);
  });

  it("ignores ordinary server logs, including ones quoting a link", () => {
    expect(authorizationUrlFromLine("I0905 11:02:06.473720 8283299200 main.py:80] Starting AGY ACP Server...")).toBeNull();
    expect(authorizationUrlFromLine(`I0905 credential_manager.py:553] ${ANTIGRAVITY_AUTH_PREFIX}${authorizationUrl}`)).toBeNull();
    expect(authorizationUrlFromLine("__OPENMAUS_ANTIGRAVITY_AUTH_URL__not-json")).toBeNull();
    expect(authorizationUrlFromLine("")).toBeNull();
  });

  it("ties a pasted remote callback to the active state and loopback port", () => {
    expect(validateAntigravityCallbackUrl(
      { redirectUri, state },
      `${redirectUri}?code=secret&state=${state}&iss=${encodeURIComponent("https://accounts.google.com")}`,
    ).searchParams.get("code")).toBe("secret");
    expect(() => validateAntigravityCallbackUrl(
      { redirectUri, state },
      `${redirectUri}?code=secret&state=wrong`,
    )).toThrow(/does not belong/u);
  });
});

describe("Antigravity driver over shared ACP", () => {
  let instance: ProviderInstance | null = null;
  let recorder: EventRecorder | null = null;

  afterEach(async () => {
    recorder?.stop();
    await instance?.dispose();
  });

  it("uses managed setup and defaults to approval cards", () => {
    expect(AntigravityDriver.defaultConfig()).toEqual({ cli: "agy", fullAuto: false, workspace: undefined });
    expect(AntigravityDriver.install?.docsUrl).toContain("antigravity-acp");
    if (resolveAntigravityReleaseAsset()) expect(AntigravityDriver.install?.managed?.downloadBytes).toBeGreaterThan(0);
    expect(antigravityPermissionMode(false)).toBe("default");
    expect(antigravityPermissionMode(false, "ask")).toBe("default");
    expect(antigravityPermissionMode(false, "auto")).toBe("default");
    expect(antigravityPermissionMode(false, "edits")).toBe("auto_edit");
    expect(antigravityPermissionMode(false, "full")).toBe("yolo");
    expect(antigravityPermissionMode(true)).toBe("yolo");
    expect(antigravityPermissionMode(true, "edits")).toBe("yolo");
  });

  it("returns staging failures as rejected promises before dispatch", async () => {
    const fake = fakeRuntime();
    instance = await AntigravityDriver.create({
      instanceId: "antigravity-staging-failure", displayName: "Antigravity",
      environment: {}, enabled: true, config: { cli: fake.executable, fullAuto: false },
    });
    const file = join(fake.directory, "missing-skill", "SKILL.md");
    const pending = instance.adapter.sendTurn({
      threadId: "staging-failure", text: "Read " + JSON.stringify(file), skillFiles: [file], cwd: fake.directory,
    });
    await expect(pending).rejects.toThrow("Antigravity skill folders must be real directories.");
  });

  it.each(["ask", "edits", "auto", "full"] as const)("runs an authenticated %s turn with explicit mode and session-scoped MCP", async (approvalMode) => {
    ensureDirs();
    const fake = fakeRuntime();
    const dump = join(fake.directory, "dump.json");
    const instanceId = "antigravity-work";
    const tokenDirectory = join(antigravityProfileDirectory(instanceId), "antigravity-acp");
    mkdirSync(tokenDirectory, { recursive: true });
    writeFileSync(join(tokenDirectory, "acp_token.json"), "{}", { mode: 0o600 });
    const replies = new Map<string, any>();
    let received!: () => void;
    const fileRequestsFinished = new Promise<void>((resolve) => { received = resolve; });
    const spawn = procs.spawnCli;
    vi.spyOn(procs, "spawnCli").mockImplementation((...args) => {
      const child = spawn(...args);
      const write = child.stdin.write.bind(child.stdin);
      vi.spyOn(child.stdin, "write").mockImplementation((...writeArgs) => {
        const message = JSON.parse(String(writeArgs[0]));
        if (message.method === "session/prompt") {
          const path = JSON.parse(message.params.prompt[0].text.slice(5)) as string;
          const calls = [
            { id: "skill-read", method: "fs/read_text_file", path },
            { id: "reference-read", method: "fs/read_text_file", path: join(dirname(path), "references", "guide.md") },
            { id: "skill-write", method: "fs/write_text_file", path, content: "unreviewed" },
            { id: "token-read", method: "fs/read_text_file", path: join(tokenDirectory, "acp_token.json") },
          ];
          for (const call of calls) child.stdout.emit("data", Buffer.from(JSON.stringify({
            jsonrpc: "2.0", id: call.id, method: call.method, params: { sessionId: message.params.sessionId, path: call.path, content: call.content },
          }) + "\n"));
        } else if (["skill-read", "reference-read", "skill-write", "token-read"].includes(message.id)) {
          replies.set(message.id, message);
          if (replies.size === 4) received();
        }
        return write(...writeArgs);
      });
      return child;
    });
    instance = await AntigravityDriver.create({
      instanceId,
      displayName: "Antigravity Work",
      environment: {
        GEMINI_API_KEY: "must-not-leak",
        GOOGLE_API_KEY: "also-must-not-leak",
        FAKE_ACP_AUTH_METHOD: "oauth-personal",
        FAKE_ACP_MODELS: "gemini-3.8-flash",
        FAKE_ACP_VARIANTS: JSON.stringify({
          "gemini-3.8-flash": {
            id: "thinking_level",
            currentValue: "medium",
            options: [
              { value: "low", name: "Low" },
              { value: "medium", name: "Medium" },
              { value: "high", name: "High" },
            ],
          },
        }),
        FAKE_ACP_MODES: "default,yolo,auto_edit",
        FAKE_ACP_DUMP: dump,
        FAKE_ACP_DUMP_PROMPT: "1",
        // Inherited temp folders: replaced on Windows, passed through elsewhere.
        TEMP: fake.directory,
        TMP: fake.directory,
      },
      enabled: true,
      config: { cli: fake.executable, fullAuto: false },
    });
    recorder = recordEvents(instance.adapter);
    const skillDirectory = join(DATA_DIR, "workspaces", "skill-bot", "skills", ".revisions", "a".repeat(64));
    mkdirSync(join(skillDirectory, "references"), { recursive: true });
    const skillFile = join(skillDirectory, "SKILL.md");
    writeFileSync(skillFile, "Read references/guide.md.");
    writeFileSync(join(skillDirectory, "references", "guide.md"), "Reviewed instructions");
    const { turnId } = await instance.adapter.sendTurn({
      threadId: "thread-antigravity",
      text: "Read " + JSON.stringify(skillFile),
      skillFiles: [skillFile],
      approvalMode,
      resumeCursor: "fake-acp-session",
      // Existing bots can have the pre-variant fallback ID saved. The official
      // runtime only accepts the base model plus its thinking-level option.
      model: "gemini-3.8-flash-high",
      integrations: {
        custom: { docs: { command: "docs-mcp", args: ["serve"], env: { TOKEN: "scoped" } } },
      },
      cwd: fake.directory,
    });
    await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId);
    const events = recorder.events.filter((event) => event.turnId === turnId);
    expect(events.some((event) => event.type === "item.completed" && event.itemType === "assistant_text")).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "turn.completed", ok: true });
    const prompt = JSON.parse(readFileSync(`${dump}.prompt.json`, "utf8"));
    const stagedFile = JSON.parse(prompt[0].text.slice(5)) as string;
    expect(stagedFile.startsWith(join(realpathSync.native(antigravityProfileDirectory(instanceId)), "omb-skills") + (process.platform === "win32" ? "\\" : "/"))).toBe(true);
    expect(readFileSync(stagedFile, "utf8")).toBe("Read references/guide.md.");
    expect(readFileSync(join(dirname(stagedFile), "references", "guide.md"), "utf8")).toBe("Reviewed instructions");
    await fileRequestsFinished;
    expect(replies.get("skill-read").result).toEqual({ content: "Read references/guide.md." });
    expect(replies.get("reference-read").result).toEqual({ content: "Reviewed instructions" });
    expect(replies.get("skill-write").error.message).toContain("outside");
    expect(replies.get("token-read").error.message).toContain("outside");
    const dumpState = JSON.parse(readFileSync(dump, "utf8"));
    const turnSpawn = vi.mocked(procs.spawnCli).mock.calls.find((call) => call[2].cwd === fake.directory);
    expect(turnSpawn?.[2].box).toMatchObject({ ro: [join(antigravityProfileDirectory(instanceId), "omb-skills")] });
    expect(dumpState.argv).toEqual(process.platform === "linux" ? ["--uid="] : []);
    expect(dumpState.env.GEMINI_HOME).toBe(antigravityProfileDirectory(instanceId));
    expect(dumpState.env.GEMINI_API_KEY).toBeUndefined();
    expect(dumpState.env.GOOGLE_API_KEY).toBeUndefined();
    expect(dumpState.env.AGY_ACP_DEFAULT_MODEL).toBeUndefined();
    const calls = JSON.parse(readFileSync(`${dump}.config.json`, "utf8"));
    expect(calls).toEqual([
      { method: "session/set_config_option", params: { sessionId: "fake-acp-session", configId: "mode", value: approvalMode === "full" ? "yolo" : approvalMode === "edits" ? "auto_edit" : "default" } },
      { method: "session/set_config_option", params: { sessionId: "fake-acp-session", configId: "thinking_level", value: "high" } },
    ]);
    const mcp = JSON.parse(readFileSync(`${dump}.mcp.json`, "utf8"));
    expect(mcp).toEqual([{ name: "docs", command: "docs-mcp", args: ["serve"], env: [{ name: "TOKEN", value: "scoped" }] }]);
    // Checked on every OS, so the macOS and Linux runs prove the dump carries TEMP.
    const expectedTemp = process.platform === "win32" ? antigravityTempDir(DATA_DIR, instanceId) : fake.directory;
    expect([dumpState.env.TEMP, dumpState.env.TMP]).toEqual([expectedTemp, expectedTemp]);
  });

  const legacyPickTurn = async (instanceId: string, sessionModels: string, model: string) => {
    ensureDirs();
    const fake = fakeRuntime();
    const dump = join(fake.directory, "dump.json");
    const tokenDirectory = join(antigravityProfileDirectory(instanceId), "antigravity-acp");
    mkdirSync(tokenDirectory, { recursive: true });
    writeFileSync(join(tokenDirectory, "acp_token.json"), "{}", { mode: 0o600 });
    instance = await AntigravityDriver.create({
      instanceId,
      displayName: "Antigravity",
      environment: {
        FAKE_ACP_AUTH_METHOD: "oauth-personal",
        FAKE_ACP_MODELS: sessionModels,
        FAKE_ACP_VARIANTS: JSON.stringify(Object.fromEntries(["gemini-3.8-flash", "gemini-4-argon"].map((id) => [id, {
          id: "thinking_level",
          currentValue: "high",
          options: [{ value: "low", name: "Low" }, { value: "medium", name: "Medium" }, { value: "high", name: "High" }],
        }]))),
        FAKE_ACP_MODES: "default,yolo,auto_edit",
        FAKE_ACP_DUMP: dump,
      },
      enabled: true,
      config: { cli: fake.executable, fullAuto: false },
    });
    recorder = recordEvents(instance.adapter);
    const { turnId } = await instance.adapter.sendTurn({ threadId: "thread-legacy-pick", text: "hello", approvalMode: "ask", model, cwd: fake.directory });
    const done = await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId);
    const events = recorder.events.filter((event) => event.turnId === turnId);
    expect(events.filter((event) => event.type === "runtime.error")).toEqual([]);
    expect(done).toMatchObject({ ok: true });
    return {
      events,
      calls: JSON.parse(readFileSync(`${dump}.config.json`, "utf8")),
      selection: JSON.parse(readFileSync(`${dump}.selection.json`, "utf8")),
    };
  };

  it("runs a saved Gemini 3.8 Flash (Medium) pick as the base model at Medium thinking when the runtime offers only the base", async () => {
    const { events, calls, selection } = await legacyPickTurn("antigravity-legacy-medium", "gemini-3.8-flash", "gemini-3.8-flash-medium");
    expect(selection).toEqual({ sessionId: expect.any(String), model: "gemini-3.8-flash", variant: "medium" });
    // The session already runs the base model, so only the thinking level is set; never the retired id.
    expect(calls.filter((call: any) => call.params.configId !== "mode")).toEqual([
      { method: "session/set_config_option", params: { sessionId: selection.sessionId, configId: "thinking_level", value: "medium" } },
    ]);
    expect(events.find((event) => event.type === "session.started")).toMatchObject({ model: "gemini-3.8-flash" });
    // Thought options are still reported under the bot's saved pick, which the picker matches on.
    expect(events.filter((event) => event.type === "session.model-variants").at(-1)).toMatchObject({
      model: "gemini-3.8-flash-medium",
      variants: { currentValue: "medium" },
    });
  });

  it("runs a saved Gemini 4 Argon (High) pick as the base model at High thinking when the runtime offers only the base", async () => {
    const { calls, selection } = await legacyPickTurn("antigravity-legacy-argon", "gemini-3.8-flash,gemini-4-argon", "gemini-4-argon-high");
    expect(selection).toEqual({ sessionId: expect.any(String), model: "gemini-4-argon", variant: "high" });
    expect(calls.some((call: any) => call.params.value === "gemini-4-argon-high")).toBe(false);
  });

  it("keeps a suffixed Gemini 3.8 Flash pick unchanged when the runtime still offers it", async () => {
    const { calls, selection } = await legacyPickTurn("antigravity-suffixed-offered", "gemini-3.8-flash,gemini-3.8-flash-medium", "gemini-3.8-flash-medium");
    expect(selection).toEqual({ sessionId: expect.any(String), model: "gemini-3.8-flash-medium" });
    expect(calls.filter((call: any) => call.params.configId !== "mode")).toEqual([]);
  });

  it("maps only a retired suffixed id the session lacks, and never overrides a chosen thinking level", () => {
    const turn = { threadId: "t", text: "hi", model: "gemini-3.8-flash-low" };
    expect(normalizeAntigravityTurn(turn, ["gemini-3.8-flash"])).toEqual({ ...turn, model: "gemini-3.8-flash", variant: "low" });
    expect(normalizeAntigravityTurn(turn, ["gemini-3.8-flash", "gemini-3.8-flash-low"])).toBe(turn);
    expect(normalizeAntigravityTurn(turn, ["gemini-3.7-flash"])).toBe(turn);
    expect(normalizeAntigravityTurn({ ...turn, variant: "high" }, ["gemini-3.8-flash"])).toMatchObject({ model: "gemini-3.8-flash-low", variant: "high" });
    expect(normalizeAntigravityTurn({ ...turn, model: "gemini-4-argon-medium" }, ["gemini-3.8-flash", "gemini-4-argon"])).toEqual({ ...turn, model: "gemini-4-argon", variant: "medium" });
    expect(normalizeAntigravityTurn({ ...turn, model: "gemini-4-argon-high" }, ["gemini-4-argon", "gemini-4-argon-high"])).toEqual({ ...turn, model: "gemini-4-argon-high" });
    expect(normalizeAntigravityTurn({ ...turn, model: "gemini-4-argon-high" }, ["gemini-3.8-flash"])).toEqual({ ...turn, model: "gemini-4-argon-high" });
  });

  it("keeps one process across approval and model changes, starting on OMB's model", async () => {
    ensureDirs();
    const fake = fakeRuntime();
    const dump = join(fake.directory, "dump.json");
    const launches = join(fake.directory, "launches");
    const instanceId = "antigravity-pooled";
    const tokenDirectory = join(antigravityProfileDirectory(instanceId), "antigravity-acp");
    mkdirSync(tokenDirectory, { recursive: true });
    writeFileSync(join(tokenDirectory, "acp_token.json"), "{}", { mode: 0o600 });
    instance = await AntigravityDriver.create({
      instanceId,
      displayName: "Antigravity",
      environment: {
        AGY_ACP_DEFAULT_MODEL: "ambient-must-not-win",
        FAKE_ACP_AUTH_METHOD: "oauth-personal",
        FAKE_ACP_MODELS: "gemini-3.7-flash-high,gemini-3.8-flash-high,gemini-3.8-flash-low",
        FAKE_ACP_MODES: "default,yolo,auto_edit",
        FAKE_ACP_DUMP: dump,
        FAKE_ACP_LAUNCH_COUNT_FILE: launches,
      },
      enabled: true,
      config: { cli: fake.executable, fullAuto: false },
    });
    await instance.startupModelRefresh;
    rmSync(launches, { force: true });
    recorder = recordEvents(instance.adapter);
    const run = async (approvalMode: "ask" | "full" | "edits", model: string, threadId = "thread-pooled") => {
      const { turnId } = await instance!.adapter.sendTurn({
        threadId, text: "hello", approvalMode, model, cwd: fake.directory,
      });
      expect(await recorder!.until((event) => event.type === "turn.completed" && event.turnId === turnId)).toMatchObject({ ok: true });
    };
    // An earlier conversation's session lists the models this account offers.
    await run("ask", "gemini-3.8-flash-high", "thread-earlier");
    await run("ask", "gemini-3.8-flash-high");
    await run("full", "gemini-3.8-flash-high");
    await run("edits", "gemini-3.8-flash-low");
    expect(Number(readFileSync(launches, "utf8"))).toBe(2);
    expect(JSON.parse(readFileSync(dump, "utf8")).env.AGY_ACP_DEFAULT_MODEL).toBe("gemini-3.8-flash-high");
    expect(JSON.parse(readFileSync(`${dump}.config.json`, "utf8")).map((call: any) => [call.params.configId, call.params.value])).toEqual([
      ["mode", "default"],
      ["mode", "yolo"],
      ["model", "gemini-3.8-flash-low"],
      ["mode", "auto_edit"],
    ]);
  });

  it("never starts a session on a model this account has not offered", async () => {
    ensureDirs();
    const fake = fakeRuntime();
    const dump = join(fake.directory, "dump.json");
    const instanceId = "antigravity-unavailable";
    const tokenDirectory = join(antigravityProfileDirectory(instanceId), "antigravity-acp");
    mkdirSync(tokenDirectory, { recursive: true });
    writeFileSync(join(tokenDirectory, "acp_token.json"), "{}", { mode: 0o600 });
    instance = await AntigravityDriver.create({
      instanceId,
      displayName: "Antigravity",
      environment: {
        FAKE_ACP_AUTH_METHOD: "oauth-personal",
        FAKE_ACP_MODELS: "gemini-3.7-flash-high,gemini-3.8-flash-low",
        FAKE_ACP_MODES: "default,yolo,auto_edit",
        FAKE_ACP_DUMP: dump,
      },
      enabled: true,
      config: { cli: fake.executable, fullAuto: false },
    });
    recorder = recordEvents(instance.adapter);
    const run = async (threadId: string, model: string) => {
      const { turnId } = await instance!.adapter.sendTurn({ threadId, text: "hello", approvalMode: "ask", model, cwd: fake.directory });
      const done = await recorder!.until((event) => event.type === "turn.completed" && event.turnId === turnId);
      return { done, events: recorder!.events.filter((event) => event.turnId === turnId) };
    };
    expect((await run("thread-known", "gemini-3.8-flash-low")).done).toMatchObject({ ok: true });
    // a tier-locked model, and OMB's static default the account lacks
    for (const [index, model] of ["gemini-3.8-pro-high", STATIC_ANTIGRAVITY_MODELS.default].entries()) {
      const { done, events } = await run(`thread-unavailable-${index}`, model);
      expect(done).toMatchObject({ ok: false });
      expect(JSON.parse(readFileSync(dump, "utf8")).env.AGY_ACP_DEFAULT_MODEL).toBeUndefined();
      expect(events.find((event) => event.type === "runtime.error")).toMatchObject({ message: expect.stringContaining(model) });
      expect(events.some((event) => event.type === "item.completed" && event.itemType === "assistant_text")).toBe(false);
    }
    expect((await run("thread-offered", "gemini-3.8-flash-low")).done).toMatchObject({ ok: true });
    expect(JSON.parse(readFileSync(dump, "utf8")).env.AGY_ACP_DEFAULT_MODEL).toBe("gemini-3.8-flash-low");
  });

  it("fails closed when Antigravity does not confirm its permission mode", async () => {
    ensureDirs();
    const fake = fakeRuntime();
    const instanceId = "antigravity-unconfirmed-mode";
    const tokenDirectory = join(antigravityProfileDirectory(instanceId), "antigravity-acp");
    mkdirSync(tokenDirectory, { recursive: true });
    writeFileSync(join(tokenDirectory, "acp_token.json"), "{}", { mode: 0o600 });
    instance = await AntigravityDriver.create({
      instanceId,
      displayName: undefined,
      environment: {
        FAKE_ACP_AUTH_METHOD: "oauth-personal",
        FAKE_ACP_MODELS: "gemini-3.8-flash-high",
        FAKE_ACP_MODES: "default,yolo",
        FAKE_ACP_EMPTY_MODE_ACK: "1",
      },
      enabled: true,
      config: { cli: fake.executable, fullAuto: true },
    });
    recorder = recordEvents(instance.adapter);
    const { turnId } = await instance.adapter.sendTurn({
      threadId: "thread-unconfirmed-mode",
      text: "hello",
      cwd: fake.directory,
    });
    expect(await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId)).toMatchObject({
      ok: false,
    });
    expect(recorder.events.some(
      (event) => event.type === "runtime.error" && /did not apply yolo permission mode/u.test(event.message),
    )).toBe(true);
  });

  it("fails closed when ACP server does not advertise the mode config option", async () => {
    ensureDirs();
    const fake = fakeRuntime();
    const dump = join(fake.directory, "dump.json");
    const instanceId = "antigravity-unadvertised-mode";
    const tokenDirectory = join(antigravityProfileDirectory(instanceId), "antigravity-acp");
    mkdirSync(tokenDirectory, { recursive: true });
    writeFileSync(join(tokenDirectory, "acp_token.json"), "{}", { mode: 0o600 });
    instance = await AntigravityDriver.create({
      instanceId,
      displayName: undefined,
      environment: {
        FAKE_ACP_AUTH_METHOD: "oauth-personal",
        FAKE_ACP_MODELS: "gemini-3.8-flash-high",
        FAKE_ACP_DUMP: dump,
        FAKE_ACP_DUMP_PROMPT: "1",
      },
      enabled: true,
      config: { cli: fake.executable, fullAuto: true },
    });
    recorder = recordEvents(instance.adapter);
    const { turnId } = await instance.adapter.sendTurn({
      threadId: "thread-unadvertised-mode",
      text: "hello",
      cwd: fake.directory,
    });
    expect(await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId)).toMatchObject({
      ok: false,
    });
    expect(recorder.events.some(
      (event) => event.type === "runtime.error" && /did not advertise a permission mode/u.test(event.message),
    )).toBe(true);
    expect(existsSync(`${dump}.prompt.json`)).toBe(false);
  });

  it("runs each turn of a pooled, resumed session under that turn's own permission mode", async () => {
    ensureDirs();
    const fake = fakeRuntime();
    const dump = join(fake.directory, "dump.json");
    const rpcDump = join(fake.directory, "rpc.json");
    const launches = join(fake.directory, "launches");
    const instanceId = "antigravity-mode-per-turn";
    const tokenDirectory = join(antigravityProfileDirectory(instanceId), "antigravity-acp");
    mkdirSync(tokenDirectory, { recursive: true });
    writeFileSync(join(tokenDirectory, "acp_token.json"), "{}", { mode: 0o600 });
    instance = await AntigravityDriver.create({
      instanceId,
      displayName: "Antigravity",
      environment: {
        FAKE_ACP_AUTH_METHOD: "oauth-personal",
        FAKE_ACP_MODELS: "gemini-3.8-flash-high",
        FAKE_ACP_MODES: "default,yolo,auto_edit",
        FAKE_ACP_DUMP: dump,
        FAKE_ACP_RPC_DUMP: rpcDump,
        FAKE_ACP_LAUNCH_COUNT_FILE: launches,
      },
      enabled: true,
      config: { cli: fake.executable, fullAuto: true },
    });
    await instance.startupModelRefresh;
    rmSync(launches, { force: true });
    recorder = recordEvents(instance.adapter);
    const promptModes = () => readFileSync(`${dump}.prompts.jsonl`, "utf8").trim().split("\n")
      .map((line) => JSON.parse(line).mode as string);
    const sequence = [
      ["full", "yolo"], ["full", "yolo"], ["ask", "default"], ["auto", "default"],
      ["ask", "default"], ["full", "yolo"], ["edits", "auto_edit"], ["ask", "default"],
    ] as const;
    for (const [index, [approvalMode, native]] of sequence.entries()) {
      const { turnId } = await instance.adapter.sendTurn({
        threadId: "thread-mode-per-turn",
        text: `turn ${index}`,
        approvalMode,
        model: "gemini-3.8-flash-high",
        cwd: fake.directory,
          // The harness mints fresh MCP credentials every turn, so later turns resume on the pooled process.
        ...(index ? { resumeCursor: "fake-acp-session" } : {}),
        integrations: { agents: { command: "agents-mcp", args: [], env: { TOKEN: `turn-${index}` } } },
      });
      expect(await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId)).toMatchObject({ ok: true });
      expect(promptModes()).toHaveLength(index + 1);
      expect([approvalMode, promptModes().at(-1)]).toEqual([approvalMode, native]);
    }
    expect(Number(readFileSync(launches, "utf8"))).toBe(1);
    expect((JSON.parse(readFileSync(rpcDump, "utf8")) as string[]).filter((method) => method === "session/resume"))
      .toHaveLength(sequence.length - 1);
  });

  it.each(["empty", "error"] as const)(
    "never prompts a pooled session whose stricter mode was not confirmed (%s answer), and replaces its process",
    async (answer) => {
      ensureDirs();
      const fake = fakeRuntime();
      const dump = join(fake.directory, "dump.json");
      const launches = join(fake.directory, "launches");
      const modeAck = join(fake.directory, "mode-ack");
      const instanceId = `antigravity-unconfirmed-downgrade-${answer}`;
      const tokenDirectory = join(antigravityProfileDirectory(instanceId), "antigravity-acp");
      mkdirSync(tokenDirectory, { recursive: true });
      writeFileSync(join(tokenDirectory, "acp_token.json"), "{}", { mode: 0o600 });
      instance = await AntigravityDriver.create({
        instanceId,
        displayName: "Antigravity",
        environment: {
          FAKE_ACP_AUTH_METHOD: "oauth-personal",
          FAKE_ACP_MODELS: "gemini-3.8-flash-high",
          FAKE_ACP_MODES: "default,yolo",
          FAKE_ACP_DUMP: dump,
          FAKE_ACP_LAUNCH_COUNT_FILE: launches,
          FAKE_ACP_MODE_ACK_FILE: modeAck,
        },
        enabled: true,
        config: { cli: fake.executable, fullAuto: false },
      });
      await instance.startupModelRefresh;
      rmSync(launches, { force: true });
      recorder = recordEvents(instance.adapter);
      const promptModes = () => existsSync(`${dump}.prompts.jsonl`)
        ? readFileSync(`${dump}.prompts.jsonl`, "utf8").trim().split("\n").map((line) => JSON.parse(line).mode as string)
        : [];
      const turn = (approvalMode: "full" | "ask", index: number, startupRecovery = false) => instance!.adapter.sendTurn({
        threadId: "thread-unconfirmed-downgrade",
        text: `turn ${index}`,
        approvalMode,
        model: "gemini-3.8-flash-high",
        cwd: fake.directory,
        ...(index ? { resumeCursor: "fake-acp-session" } : {}),
        ...(startupRecovery ? { startupRecovery } : {}),
      });
      const run = async (approvalMode: "full" | "ask", index: number) => {
        const { turnId } = await turn(approvalMode, index);
        return recorder!.until((event) => event.type === "turn.completed" && event.turnId === turnId);
      };
      expect(await run("full", 0)).toMatchObject({ ok: true });
      expect(promptModes()).toEqual(["yolo"]);
      // The owner switches to Ask; the runtime does not confirm the switch.
      writeFileSync(modeAck, answer);
      expect(await run("ask", 1)).toMatchObject({ ok: false });
      expect(promptModes()).toEqual(["yolo"]);
      writeFileSync(modeAck, "");
      expect(await run("ask", 2)).toMatchObject({ ok: true });
      expect(promptModes()).toEqual(["yolo", "default"]);
      expect(Number(readFileSync(launches, "utf8"))).toBe(2);
      expect(await run("full", 3)).toMatchObject({ ok: true });
      writeFileSync(modeAck, answer);
      await expect(turn("ask", 4, true)).rejects.toBeInstanceOf(TurnNotStartedError);
      expect(promptModes()).toEqual(["yolo", "default", "yolo"]);
      writeFileSync(modeAck, "");
      expect(await run("ask", 5)).toMatchObject({ ok: true });
      expect(promptModes()).toEqual(["yolo", "default", "yolo", "default"]);
      expect(Number(readFileSync(launches, "utf8"))).toBe(3);
    },
  );

  it.each([
    ["question", undefined, undefined],
    ["question", "full", undefined],
    ["permission", "full", undefined],
    ["permission", "ask", "CommandLine"],
    ["permission", "ask", "conflicting commands"],
  ] as const)("keeps Antigravity %s requests interactive with mode %s and input %s", async (requestKind, approvalMode, commandInput) => {
    ensureDirs();
    const fake = fakeRuntime();
    const command = "  printf 'synthetic permission'\n  pwd  ";
    const commandCwd = join(fake.directory, "native-shell");
    if (commandInput) mkdirSync(commandCwd);
    const instanceId = "antigravity-question";
    const tokenDirectory = join(antigravityProfileDirectory(instanceId), "antigravity-acp");
    mkdirSync(tokenDirectory, { recursive: true });
    writeFileSync(join(tokenDirectory, "acp_token.json"), "{}", { mode: 0o600 });
    instance = await AntigravityDriver.create({
      instanceId,
      displayName: undefined,
      environment: {
        FAKE_ACP_MODE: requestKind,
        FAKE_ACP_PAD_QUESTION_OPTION: "1",
        FAKE_ACP_AUTH_METHOD: "oauth-personal",
        FAKE_ACP_MODELS: "gemini-3.8-flash-high",
        FAKE_ACP_MODES: "default,yolo",
        ...(commandInput ? { FAKE_ACP_PERMISSION_TOOL_CALL: JSON.stringify({
          kind: "execute", title: "Truncated command preview", rawInput: {
            CommandLine: command, Cwd: commandCwd,
            ...(commandInput === "conflicting commands" ? { command: "different command" } : {}),
          },
        }) } : {}),
      },
      enabled: true,
      config: { cli: fake.executable, fullAuto: true },
    });
    recorder = recordEvents(instance.adapter);
    await instance.adapter.sendTurn({ threadId: "thread-question", text: "ask me", cwd: fake.directory, approvalMode });
    const opened = await recorder.until((event) => event.type === "request.opened");
    expect(opened).toMatchObject({ requestType: requestKind });
    if (commandInput) expect(opened).toHaveProperty("command", commandInput === "CommandLine" ? { command, cwd: commandCwd } : undefined);
    if (requestKind === "question") expect(opened).toMatchObject({ summary: "Which color?", choices: ["Blue", "Green"] });
    await instance.adapter.respondToRequest("thread-question", (opened as { requestId: string }).requestId, {
      behavior: requestKind === "question" ? "answer" : "allow",
      message: "Green",
    });
    expect(await recorder.until((event) => event.type === "request.resolved")).toMatchObject({
      behavior: requestKind === "question" ? "answer" : "allow",
      source: "user",
    });
    expect(await recorder.until((event) => event.type === "turn.completed")).toMatchObject({ ok: true });
  });

  it("detects and runs an installed agy CLI (v1.5+) over `agy acp --stdio` with its native mode vocabulary", async () => {
    ensureDirs();
    const dir = mkdtempSync(join(tmpdir(), "omb-agy-cli-"));
    scratch.push(dir);
    const agyScript = join(dir, process.platform === "win32" ? "agy.mjs" : "agy");
    const agyBin = process.platform === "win32" ? join(dir, "agy.cmd") : agyScript;
    const dump = join(dir, "dump.json");
    writeFileSync(agyScript, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "acp" && args.includes("--help")) {
  console.log("Usage: agy acp [flags]\\n\\nStart the Agent Client Protocol (ACP) stdio server");
  process.exit(0);
}
if (args.includes("--version")) {
  console.log("1.5.14");
  process.exit(0);
}
await import(${JSON.stringify(pathToFileURL(FAKE_ACP).href)});
`, { mode: 0o755 });
    if (process.platform === "win32") {
      writeFileSync(agyBin, `@echo off\r\n"${process.execPath}" "%~dp0agy.mjs" %*\r\n`);
    }
    const pathWithNode = `${dir}${delimiter}${dirname(process.execPath)}`;
    const runtime = await resolveAntigravityRuntime(agyBin, { PATH: pathWithNode }, dir);
    expect(isAntigravityCli(runtime)).toBe(true);
    expect(runtime).toMatchObject({ executablePath: agyBin, kind: "cli", source: "override", version: "1.5.14" });
    const fromPath = await resolveAntigravityRuntime(undefined, { PATH: pathWithNode }, dir);
    expect(fromPath).toMatchObject({ executablePath: agyBin, kind: "cli", source: "path", version: "1.5.14" });
    expect(antigravitySpawnArgs(runtime)).toEqual(["acp", "--stdio", "--disable-telemetry"]);
    await expect(prepareAntigravitySpawn(runtime, { PATH: pathWithNode }, { fullAuto: true })).resolves.toMatchObject({
      command: antigravityExecutablePath(runtime),
      args: ["acp", "--stdio", "--disable-telemetry", "--dangerously-skip-permissions"],
    });
    expect(antigravityPermissionMode(false, "ask", ["default", "accept-edits", "auto", "plan"])).toBe("default");
    expect(antigravityPermissionMode(false, "edits", ["default", "accept-edits", "auto", "plan"])).toBe("accept-edits");
    expect(antigravityPermissionMode(false, "auto", ["default", "accept-edits", "auto", "plan"])).toBe("default");
    expect(antigravityPermissionMode(false, "full", ["default", "accept-edits", "auto", "plan"])).toBe("auto");
    expect(antigravityPermissionMode(true, undefined, ["default", "accept-edits", "auto", "plan"])).toBe("auto");
    expect(normalizeAntigravityTurn({ threadId: "t", text: "hi", model: "gemini-4-neon-xhigh" }, ["gemini-4-neon"]))
      .toMatchObject({ model: "gemini-4-neon", variant: "xhigh" });
    expect(isValidAntigravityInitializeResult({
      protocolVersion: 1,
      agentInfo: { name: "Antigravity ACP Server", version: "1.5.14" },
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} }, auth: { logout: {} } },
      authMethods: [{ id: "oauth-personal" }],
    }, "1.5.14")).toBe(true);

    const profile = await prepareAntigravityProfile({
      instanceId: "agy-cli-profile",
      runtime,
      baseDir: dir,
      baseEnv: { PATH: process.env.PATH, GEMINI_API_KEY: "no-leak", GOOGLE_API_KEY: "no-leak" },
    });
    expect(profile.environment.GEMINI_API_KEY).toBeUndefined();
    expect(profile.environment.GOOGLE_API_KEY).toBeUndefined();
    expect(profile.environment.ANTIGRAVITY_HARNESS_PATH).toBeUndefined();
    expect(profile.environment.GEMINI_HOME).toBeUndefined();

    instance = await AntigravityDriver.create({
      instanceId: "antigravity-cli-v15",
      displayName: "Google Gemini (Antigravity)",
      enabled: true,
      config: { cli: agyBin, fullAuto: false },
      environment: {
        FAKE_ACP_AUTH_METHOD: "oauth-personal",
        FAKE_ACP_AGENT_NAME: "Antigravity ACP Server",
        FAKE_ACP_AGENT_VERSION: "1.5.14",
        FAKE_ACP_MODELS: "gemini-4-neon,gemini-3.8-flash",
        FAKE_ACP_VARIANTS: JSON.stringify({
          "gemini-4-neon": {
            id: "thought_level",
            currentValue: "high",
            options: [{ value: "low", name: "Low" }, { value: "medium", name: "Medium" }, { value: "high", name: "High" }, { value: "xhigh", name: "Extra" }],
          },
        }),
        FAKE_ACP_MODES: "default,accept-edits,auto,plan",
        FAKE_ACP_DUMP: dump,
      },
    });
    await instance.startupModelRefresh;
    expect(await instance.snapshot()).toMatchObject({ state: "available", authenticated: true, version: "1.5.14" });
    expect(instance.models.options.map((option) => option.id)).toEqual(["gemini-4-neon", "gemini-3.8-flash"]);

    recorder = recordEvents(instance.adapter);
    const { turnId } = await instance.adapter.sendTurn({
      threadId: "thread-agy-cli",
      text: "hello",
      approvalMode: "edits",
      model: "gemini-4-neon-xhigh",
      cwd: dir,
    });
    expect(await recorder.until((event) => event.type === "turn.completed" && event.turnId === turnId)).toMatchObject({ ok: true });
    expect(JSON.parse(readFileSync(dump, "utf8")).argv).toEqual(["acp", "--stdio", "--disable-telemetry"]);
    const calls = JSON.parse(readFileSync(`${dump}.config.json`, "utf8"));
    expect(calls).toContainEqual({ method: "session/set_config_option", params: { sessionId: expect.any(String), configId: "mode", value: "accept-edits" } });
    expect(calls).toContainEqual({ method: "session/set_config_option", params: { sessionId: expect.any(String), configId: "thought_level", value: "xhigh" } });
  }, 30_000);

  function writeFakeAgyCli(
    dir: string,
    options: { helpText?: string; versionText?: string; versionExit?: number; name?: string; body?: string } = {},
  ) {
    const name = options.name ?? "agy";
    const scriptName = process.platform === "win32" ? `${name}.mjs` : name;
    const scriptPath = join(dir, scriptName);
    const binPath = process.platform === "win32" ? join(dir, `${name}.cmd`) : scriptPath;
    const helpText = options.helpText ?? "Usage: agy acp [flags]\\n\\nStart the Agent Client Protocol (ACP) stdio server";
    const versionExit = options.versionExit ?? 0;
    const versionText = options.versionText ?? "1.5.14";
    const body = options.body ?? `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "acp" && args.includes("--help")) {
  console.log(${JSON.stringify(helpText)});
  process.exit(0);
}
if (args.includes("--version")) {
  ${versionText ? `console.log(${JSON.stringify(versionText)});` : ""}
  process.exit(${versionExit});
}
await import(${JSON.stringify(pathToFileURL(FAKE_ACP).href)});
`;
    writeFileSync(scriptPath, body, { mode: 0o755 });
    if (process.platform === "win32") {
      writeFileSync(binPath, `@echo off\r\n"${process.execPath}" "%~dp0${scriptName}" %*\r\n`);
    }
    return { scriptPath, binPath };
  }

  it("re-verifies live before adding skip-permissions and rejects in-place rewrites, stale runtimes, symlink retargets, and wrapper payload swaps", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-agy-verify-"));
    scratch.push(dir);
    const { scriptPath, binPath } = writeFakeAgyCli(dir);
    const pathWithNode = `${dir}${delimiter}${dirname(process.execPath)}`;
    const verified = await resolveAntigravityRuntime(binPath, { PATH: pathWithNode }, dir);
    await expect(verifyAntigravityCli(verified, { PATH: pathWithNode })).resolves.toMatchObject({ kind: "cli", version: "1.5.14" });
    await expect(prepareAntigravitySpawn(verified, { PATH: pathWithNode }, { fullAuto: true })).resolves.toMatchObject({
      args: ["acp", "--stdio", "--disable-telemetry", "--dangerously-skip-permissions"],
    });
    expect(antigravitySpawnArgs(verified)).toEqual(["acp", "--stdio", "--disable-telemetry"]);
    await expect(prepareAntigravitySpawn(
      { executablePath: join(dir, "forged"), harnessPath: "", kind: "cli", source: "override", version: "1.5.14" },
      { PATH: pathWithNode },
      { fullAuto: true },
    )).rejects.toMatchObject({ status: 409 });

    const before = statSync(scriptPath, { bigint: true });
    const replacement = `#!/usr/bin/env node\nconsole.log("not agy");\nprocess.exit(0);\n`;
    const padded = replacement.padEnd(Number(before.size), " ");
    expect(Buffer.byteLength(padded)).toBe(Number(before.size));
    writeFileSync(scriptPath, padded, { mode: 0o755 });
    utimesSync(scriptPath, new Date(Number(before.atimeMs)), new Date(Number(before.mtimeMs)));
    const after = statSync(scriptPath, { bigint: true });
    expect(after.size).toBe(before.size);
    if (process.platform !== "win32") expect(after.ino).toBe(before.ino);

    await expect(verifyAntigravityCli(verified, { PATH: pathWithNode })).resolves.toBeNull();
    await expect(prepareAntigravitySpawn(verified, { PATH: pathWithNode }, { fullAuto: true })).rejects.toMatchObject({ status: 409 });
    await expect(resolveAntigravityRuntime(binPath, { PATH: pathWithNode }, dir)).rejects.toThrow(/official/u);

    if (process.platform !== "win32") {
      const good = writeFakeAgyCli(dir, { name: "good-bin", helpText: "Usage: antigravity acp [flags]", versionText: "1.5.14" });
      const bad = writeFakeAgyCli(dir, { name: "bad-bin", body: "#!/usr/bin/env node\nconsole.log('nope');\n" });
      const link = join(dir, "antigravity");
      symlinkSync(good.binPath, link);
      const linked = await resolveAntigravityRuntime(link, { PATH: pathWithNode }, dir);
      expect(linked).toMatchObject({ kind: "cli", version: "1.5.14" });
      unlinkSync(link);
      symlinkSync(bad.binPath, link);
      await expect(verifyAntigravityCli(linked, { PATH: pathWithNode })).resolves.toBeNull();
      await expect(prepareAntigravitySpawn(linked, { PATH: pathWithNode }, { fullAuto: true })).rejects.toMatchObject({ status: 409 });
      await expect(resolveAntigravityRuntime(link, { PATH: pathWithNode }, dir)).rejects.toThrow();

      // Stable wrapper exec payload swap: wrapper bytes stay identical while its target payload changes.
      const wrapDir = mkdtempSync(join(tmpdir(), "omb-agy-wrapper-"));
      scratch.push(wrapDir);
      const payloadPath = join(wrapDir, "payload");
      const wrapperPath = join(wrapDir, "agy");
      const logPath = join(wrapDir, "payload.log");
      writeFileSync(payloadPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "acp" && args.includes("--help")) { console.log("Usage: agy acp [flags]"); process.exit(0); }
if (args.includes("--version")) { console.log("1.5.14"); process.exit(0); }
`, { mode: 0o755 });
      writeFileSync(wrapperPath, `#!/bin/sh\nexec "${payloadPath}" "$@"\n`, { mode: 0o755 });
      const wrapEnv = { PATH: `${wrapDir}${delimiter}${dirname(process.execPath)}` };
      const wrapped = await resolveAntigravityRuntime(wrapperPath, wrapEnv, wrapDir);
      expect(wrapped).toMatchObject({ kind: "cli", source: "override", version: "1.5.14" });
      const wrapStatBefore = statSync(wrapperPath, { bigint: true });

      writeFileSync(payloadPath, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(logPath)}, "NEW " + process.argv.slice(2).join(" ") + "\\n");
console.log("not a probed cli");
process.exit(0);
`, { mode: 0o755 });
      const wrapStatAfter = statSync(wrapperPath, { bigint: true });
      expect(wrapStatAfter.ino).toBe(wrapStatBefore.ino);
      expect(wrapStatAfter.size).toBe(wrapStatBefore.size);
      await expect(resolveAntigravityRuntime(wrapperPath, wrapEnv, wrapDir)).rejects.toThrow(/official/u);
      await expect(prepareAntigravitySpawn(wrapped, wrapEnv, { fullAuto: true })).rejects.toMatchObject({ status: 409 });
      const logged = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
      expect(logged).toContain("NEW acp --help");
      expect(logged).not.toContain("--dangerously-skip-permissions");
    }
  });

  it("refuses a Full turn without skip-permissions when the CLI file is swapped between mode probe and spawn", async () => {
    if (process.platform === "win32") return;
    ensureDirs();
    const dir = mkdtempSync(join(tmpdir(), "omb-agy-swap-race-"));
    scratch.push(dir);
    const binPath = join(dir, "agy");
    const logPath = join(dir, "exec.log");
    const probeStarted = join(dir, "probe-started");
    const releaseProbe = join(dir, "release-probe");
    const dump = join(dir, "dump.json");

    writeFileSync(binPath, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, "GOOD " + JSON.stringify(args) + "\\n");
if (args[0] === "acp" && args.includes("--help")) { console.log("Usage: agy acp [flags]"); process.exit(0); }
if (args.includes("--version")) { console.log("1.5.14"); process.exit(0); }
await import(${JSON.stringify(pathToFileURL(FAKE_ACP).href)});
`, { mode: 0o755 });

    instance = await AntigravityDriver.create({
      instanceId: "antigravity-swap-race",
      displayName: "Google Gemini (Antigravity)",
      enabled: true,
      config: { cli: binPath, fullAuto: false },
      environment: {
        FAKE_ACP_AUTH_METHOD: "oauth-personal",
        FAKE_ACP_AGENT_NAME: "Antigravity ACP Server",
        FAKE_ACP_AGENT_VERSION: "1.5.14",
        FAKE_ACP_MODELS: "gemini-3.8-flash",
        FAKE_ACP_MODES: "default,accept-edits,auto,plan",
        FAKE_ACP_DUMP: dump,
        FAKE_ACP_DUMP_PROMPT: "1",
      },
    });
    await instance.startupModelRefresh;

    // Replace GOOD with SLEEPY so the Full mode probe misses cache and waits until we swap in EVIL.
    writeFileSync(binPath, `#!/usr/bin/env node
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, "SLEEPY " + JSON.stringify(args) + "\\n");
if (args[0] === "acp" && args.includes("--help")) { console.log("Usage: agy acp [flags]"); process.exit(0); }
if (args.includes("--version")) { console.log("1.5.14"); process.exit(0); }
if (!existsSync(${JSON.stringify(probeStarted)})) {
  writeFileSync(${JSON.stringify(probeStarted)}, "1");
  while (!existsSync(${JSON.stringify(releaseProbe)})) {
    await new Promise((r) => setTimeout(r, 20));
  }
}
await import(${JSON.stringify(pathToFileURL(FAKE_ACP).href)});
`, { mode: 0o755 });

    recorder = recordEvents(instance.adapter);
    const turnPromise = instance.adapter.sendTurn({
      threadId: "thread-swap-race",
      text: "hello",
      approvalMode: "full",
      model: "gemini-3.8-flash",
      cwd: dir,
    });

    const deadline = Date.now() + 10_000;
    while (!existsSync(probeStarted)) {
      if (Date.now() > deadline) throw new Error("timed out waiting for SLEEPY mode probe");
      await new Promise((r) => setTimeout(r, 20));
    }

    writeFileSync(binPath, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, "EVIL " + JSON.stringify(args) + "\\n");
if (args[0] === "acp" && args.includes("--help")) { console.log("not a probed cli"); process.exit(0); }
if (args.includes("--version")) { console.log("1.5.14"); process.exit(0); }
await import(${JSON.stringify(pathToFileURL(FAKE_ACP).href)});
`, { mode: 0o755 });
    writeFileSync(releaseProbe, "1");

    const { turnId } = await turnPromise;
    const completed = await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
    expect(completed).toMatchObject({ ok: false, stopReason: "setup_required" });
    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines.some((line) => line.startsWith("EVIL ") && line.includes("--help"))).toBe(true);
    expect(lines.some((line) => line.startsWith("EVIL ") && line.includes("--dangerously-skip-permissions"))).toBe(false);
    expect(lines.some((line) => line.startsWith("EVIL ") && line.includes("--stdio"))).toBe(false);
    expect(existsSync(`${dump}.prompt.json`)).toBe(false);
  }, 30_000);

  it("re-runs prepareAntigravitySpawn after engineAdmission resolves and refuses a CLI replaced during admission", async () => {
    if (process.platform === "win32") return;
    ensureDirs();
    const dir = mkdtempSync(join(tmpdir(), "omb-agy-admission-swap-"));
    scratch.push(dir);
    const binPath = join(dir, "agy");
    const logPath = join(dir, "exec.log");
    const dump = join(dir, "dump.json");

    const goodBody = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, "GOOD " + JSON.stringify(args) + "\\n");
if (args[0] === "acp" && args.includes("--help")) { console.log("Usage: agy acp [flags]"); process.exit(0); }
if (args.includes("--version")) { console.log("1.5.14"); process.exit(0); }
await import(${JSON.stringify(pathToFileURL(FAKE_ACP).href)});
`;
    const evilBody = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, "EVIL " + JSON.stringify(args) + "\\n");
if (args[0] === "acp" && args.includes("--help")) { console.log("not a probed cli"); process.exit(0); }
if (args.includes("--version")) { console.log("9.9.9"); process.exit(0); }
await import(${JSON.stringify(pathToFileURL(FAKE_ACP).href)});
`;
    writeFileSync(binPath, goodBody, { mode: 0o755 });

    instance = await AntigravityDriver.create({
      instanceId: "antigravity-admission-swap",
      displayName: "Google Gemini (Antigravity)",
      enabled: true,
      config: { cli: binPath, fullAuto: false },
      environment: {
        FAKE_ACP_AUTH_METHOD: "oauth-personal",
        FAKE_ACP_AGENT_NAME: "Antigravity ACP Server",
        FAKE_ACP_AGENT_VERSION: "1.5.14",
        FAKE_ACP_MODELS: "gemini-3.8-flash",
        FAKE_ACP_MODES: "default,accept-edits,auto,plan",
        FAKE_ACP_DUMP: dump,
        FAKE_ACP_DUMP_PROMPT: "1",
      },
    });
    await instance.startupModelRefresh;

    const realSpawn = procs.spawnCli;
    const spawnedAfterAdmission: Array<{ command: string; args: string[] }> = [];
    let admissionResolved = false;
    const spawnSpy = vi.spyOn(procs, "spawnCli").mockImplementation((...args) => {
      if (admissionResolved) spawnedAfterAdmission.push({ command: args[0], args: [...args[1]] });
      return realSpawn(...args);
    });

    try {
      recorder = recordEvents(instance.adapter);
      const { turnId } = await instance.adapter.sendTurn({
        threadId: "thread-admission-swap",
        text: "hello",
        approvalMode: "full",
        model: "gemini-3.8-flash",
        cwd: dir,
        engineAdmission: async () => {
          appendFileSync(logPath, "ADMISSION_SWAP\n");
          await new Promise((r) => setTimeout(r, 40));
          writeFileSync(binPath, evilBody, { mode: 0o755 });
          await new Promise((r) => setTimeout(r, 40));
          admissionResolved = true;
        },
      });
      const completed = await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
      expect(completed).toMatchObject({ ok: false, stopReason: "setup_required" });
      const setupError = recorder.events.find((e) => e.type === "runtime.error" && e.turnId === turnId);
      expect(setupError).toMatchObject({ setup: true });
      expect(spawnedAfterAdmission).toEqual([]);
      expect(existsSync(`${dump}.prompt.json`)).toBe(false);

      const swapLines = readFileSync(logPath, "utf8").trim().split("\n");
      const admissionIndex = swapLines.indexOf("ADMISSION_SWAP");
      expect(admissionIndex).toBeGreaterThanOrEqual(0);
      const afterSwapAdmission = swapLines.slice(admissionIndex + 1);
      expect(afterSwapAdmission).toEqual(['EVIL ["acp","--help"]']);
      expect(swapLines.some((line) => line.startsWith("EVIL ") && line.includes("--dangerously-skip-permissions"))).toBe(false);
      expect(swapLines.some((line) => line.startsWith("EVIL ") && line.includes("--stdio"))).toBe(false);

      // Restore the verified CLI and confirm the post-admission probe still runs immediately before spawnCli.
      writeFileSync(binPath, goodBody, { mode: 0o755 });
      admissionResolved = false;
      const { turnId: okTurnId } = await instance.adapter.sendTurn({
        threadId: "thread-admission-ok",
        text: "hello",
        approvalMode: "full",
        model: "gemini-3.8-flash",
        cwd: dir,
        engineAdmission: async () => {
          appendFileSync(logPath, "ADMISSION_OK\n");
          admissionResolved = true;
        },
      });
      expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === okTurnId)).toMatchObject({ ok: true });
      const okLines = readFileSync(logPath, "utf8").trim().split("\n");
      const okAdmissionIndex = okLines.indexOf("ADMISSION_OK");
      expect(okAdmissionIndex).toBeGreaterThanOrEqual(0);
      expect(okLines.slice(okAdmissionIndex + 1)).toEqual([
        'GOOD ["acp","--help"]',
        'GOOD ["--version"]',
        'GOOD ["acp","--stdio","--disable-telemetry","--dangerously-skip-permissions"]',
      ]);
      expect(spawnedAfterAdmission).toEqual([{
        command: realpathSync(binPath),
        args: ["acp", "--stdio", "--disable-telemetry", "--dangerously-skip-permissions"],
      }]);
    } finally {
      spawnSpy.mockRestore();
    }
  }, 30_000);

  it("probes and spawns mise-style argv0 shims via the PATH entry without caching under the shim target hash", async () => {
    if (process.platform === "win32") return;
    ensureDirs();
    const baseDir = mkdtempSync(join(tmpdir(), "omb-agy-mise-shim-"));
    scratch.push(baseDir);
    const miseDir = join(baseDir, "usr-bin");
    const shimsDir = join(baseDir, "mise-shims");
    const shimsAltDir = join(baseDir, "mise-shims-alt");
    mkdirSync(miseDir, { recursive: true });
    mkdirSync(shimsDir, { recursive: true });
    mkdirSync(shimsAltDir, { recursive: true });

    const asset = resolveAntigravityReleaseAsset();
    if (asset) {
      const versionDir = join(baseDir, "tools", "antigravity-acp", `${process.platform}-${process.arch}`, "versions", asset.sha256);
      mkdirSync(versionDir, { recursive: true });
      for (const file of [asset.executable, asset.harness]) {
        const target = join(versionDir, file.name);
        writeFileSync(target, "");
        truncateSync(target, file.bytes);
        chmodSync(target, 0o755);
      }
      writeFileSync(join(versionDir, ".install-complete.json"), JSON.stringify({
        sha256: asset.sha256,
        version: asset.version,
        executable: asset.executable,
        harness: asset.harness,
      }));
    }

    const misePath = join(miseDir, "mise");
    const stateFile = join(baseDir, "mise-state");
    const dump = join(baseDir, "dump.json");
    writeFileSync(stateFile, "1.5.14");
    writeFileSync(misePath, `#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { basename } from "node:path";
const invokedAs = basename(process.argv[1] ?? "");
const args = process.argv.slice(2);
if (invokedAs !== "agy") {
  if (args.includes("--version")) { console.log("2026.11.10 linux-x64"); process.exit(0); }
  console.error("unknown command: " + (args[0] ?? ""));
  process.exit(1);
}
const mode = readFileSync(${JSON.stringify(stateFile)}, "utf8").trim();
if (mode === "broken") {
  console.error("agy uninstalled");
  process.exit(1);
}
if (args[0] === "acp" && args.includes("--help")) {
  console.log("Usage: agy acp [flags]");
  process.exit(0);
}
if (args.includes("--version")) {
  console.log(mode);
  process.exit(0);
}
await import(${JSON.stringify(pathToFileURL(FAKE_ACP).href)});
`, { mode: 0o755 });

    const shimPath = join(shimsDir, "agy");
    const altShimPath = join(shimsAltDir, "agy");
    symlinkSync(misePath, shimPath);
    symlinkSync(misePath, altShimPath);

    const shimEnv = { PATH: `${shimsDir}${delimiter}${dirname(process.execPath)}` };
    const resolved = await resolveAntigravityRuntime("agy", shimEnv, baseDir);
    expect(resolved).toMatchObject({
      executablePath: shimPath,
      kind: "cli",
      source: "path",
      version: "1.5.14",
      cliVerification: {
        launchPath: shimPath,
        realpath: realpathSync(misePath),
        isShim: true,
        sha256: "",
      },
    });
    expect(antigravityExecutablePath(resolved)).toBe(shimPath);
    expect(cliProbeKey(resolved.cliVerification!)).toBe(`shim\0${shimPath}`);

    const prepared = await prepareAntigravitySpawn(resolved, shimEnv, { fullAuto: true });
    expect(prepared).toMatchObject({
      command: shimPath,
      args: ["acp", "--stdio", "--disable-telemetry", "--dangerously-skip-permissions"],
    });

    const explicitShim = await resolveAntigravityRuntime(shimPath, { PATH: dirname(process.execPath) }, baseDir);
    expect(explicitShim).toMatchObject({
      executablePath: shimPath,
      kind: "cli",
      source: "override",
      version: "1.5.14",
    });

    // When mise stops resolving agy, neither the original shim nor another symlink to mise succeeds from cache.
    writeFileSync(stateFile, "broken");
    await expect(verifyAntigravityCli(resolved, shimEnv)).resolves.toBeNull();
    await expect(prepareAntigravitySpawn(resolved, shimEnv, { fullAuto: true })).rejects.toMatchObject({ status: 409 });
    await expect(resolveAntigravityRuntime(altShimPath, { PATH: dirname(process.execPath) }, baseDir)).rejects.toMatchObject({ status: 409 });

    // Restore shim and run a full driver turn through the shim path.
    writeFileSync(stateFile, "1.5.14");
    instance = await AntigravityDriver.create({
      instanceId: "antigravity-mise-shim",
      displayName: "Google Gemini (Antigravity)",
      enabled: true,
      config: { cli: shimPath, fullAuto: false },
      environment: {
        FAKE_ACP_AUTH_METHOD: "oauth-personal",
        FAKE_ACP_AGENT_NAME: "Antigravity ACP Server",
        FAKE_ACP_AGENT_VERSION: "1.5.14",
        FAKE_ACP_MODELS: "gemini-3.8-flash",
        FAKE_ACP_MODES: "default,accept-edits,auto,plan",
        FAKE_ACP_DUMP: dump,
      },
    });
    await instance.startupModelRefresh;
    expect(await instance.snapshot()).toMatchObject({ state: "available", authenticated: true, version: "1.5.14" });
    recorder = recordEvents(instance.adapter);
    const { turnId } = await instance.adapter.sendTurn({
      threadId: "thread-mise-shim",
      text: "hello shim",
      approvalMode: "full",
      model: "gemini-3.8-flash",
      cwd: baseDir,
    });
    expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId)).toMatchObject({ ok: true });
    expect(JSON.parse(readFileSync(dump, "utf8")).argv).toEqual([
      "acp", "--stdio", "--disable-telemetry", "--dangerously-skip-permissions",
    ]);
  }, 30_000);

  it("keeps explicit agy paths strictly scoped to that path and only searches PATH for the default command", async () => {
    const baseDir = mkdtempSync(join(tmpdir(), "omb-agy-explicit-"));
    scratch.push(baseDir);
    const asset = resolveAntigravityReleaseAsset();
    if (asset) {
      const versionDir = join(baseDir, "tools", "antigravity-acp", `${process.platform}-${process.arch}`, "versions", asset.sha256);
      mkdirSync(versionDir, { recursive: true });
      for (const file of [asset.executable, asset.harness]) {
        const target = join(versionDir, file.name);
        writeFileSync(target, "");
        truncateSync(target, file.bytes);
        if (process.platform !== "win32") chmodSync(target, 0o755);
      }
      writeFileSync(join(versionDir, ".install-complete.json"), JSON.stringify({
        sha256: asset.sha256,
        version: asset.version,
        executable: asset.executable,
        harness: asset.harness,
      }));
    }

    const pathDir = join(baseDir, "path-v15");
    const oldDir = join(baseDir, "old-v149");
    const overrideDir = join(baseDir, "override-v159");
    const managedOverrideDir = join(baseDir, "override-managed");
    mkdirSync(pathDir, { recursive: true });
    mkdirSync(oldDir, { recursive: true });
    mkdirSync(overrideDir, { recursive: true });
    mkdirSync(managedOverrideDir, { recursive: true });

    const pathAgy = writeFakeAgyCli(pathDir, { versionText: "1.5.14" });
    const oldAgy = writeFakeAgyCli(oldDir, { versionText: "1.4.9" });
    const overrideAgy = writeFakeAgyCli(overrideDir, { versionText: "1.5.9" });
    const fakeManaged = fakeRuntime();
    const customManagedAgy = join(managedOverrideDir, process.platform === "win32" ? "agy.exe" : "agy");
    const customManagedHarness = join(managedOverrideDir, process.platform === "win32" ? "localharness_external.exe" : "localharness_external");
    copyFileSync(fakeManaged.executable, customManagedAgy);
    copyFileSync(fakeManaged.harness, customManagedHarness);
    if (process.platform !== "win32") {
      chmodSync(customManagedAgy, 0o755);
      chmodSync(customManagedHarness, 0o755);
    }

    const pathWithV15 = `${pathDir}${delimiter}${dirname(process.execPath)}`;
    const pathNodeOnly = dirname(process.execPath);

    // Explicit v1.4.9 agy or missing .../agy never falls through to PATH v1.5.14 or managed 1.4.3.
    await expect(resolveAntigravityRuntime(oldAgy.binPath, { PATH: pathWithV15 }, baseDir)).rejects.toMatchObject({ status: 409 });
    await expect(resolveAntigravityRuntime(oldAgy.binPath, { PATH: "" }, baseDir)).rejects.toMatchObject({ status: 409 });
    await expect(resolveAntigravityRuntime(join(baseDir, "missing", "agy"), { PATH: pathWithV15 }, baseDir)).rejects.toMatchObject({ status: 409 });

    // Explicit verified v1.5.9 CLI beats PATH v1.5.14.
    await expect(resolveAntigravityRuntime(overrideAgy.binPath, { PATH: pathWithV15 }, baseDir)).resolves.toMatchObject({
      executablePath: overrideAgy.binPath,
      kind: "cli",
      source: "override",
      version: "1.5.9",
    });

    // Explicit path with sibling localharness_external returns that path's ACP server.
    await expect(resolveAntigravityRuntime(customManagedAgy, { PATH: pathWithV15 }, baseDir)).resolves.toMatchObject({
      executablePath: customManagedAgy,
      harnessPath: customManagedHarness,
      source: "override",
    });

    // Default command ("agy") or unset searches PATH.
    await expect(resolveAntigravityRuntime("agy", { PATH: pathWithV15 }, baseDir)).resolves.toMatchObject({
      executablePath: pathAgy.binPath,
      kind: "cli",
      source: "path",
      version: "1.5.14",
    });
    await expect(resolveAntigravityRuntime(undefined, { PATH: pathWithV15 }, baseDir)).resolves.toMatchObject({
      executablePath: pathAgy.binPath,
      kind: "cli",
      source: "path",
      version: "1.5.14",
    });
    if (asset) {
      await expect(resolveAntigravityRuntime("agy", { PATH: pathNodeOnly }, baseDir)).resolves.toMatchObject({
        source: "managed",
        version: asset.version,
      });
    }
  });

  it("accepts the CLI only when help names the acp command and --version parses to >= 1.5.0", async () => {
    expect(isSupportedAntigravityCliVersion("1.5.0")).toBe(true);
    expect(isSupportedAntigravityCliVersion("1.5.14")).toBe(true);
    expect(isSupportedAntigravityCliVersion("2.0.0")).toBe(true);
    expect(isSupportedAntigravityCliVersion("1.4.9")).toBe(false);
    expect(isSupportedAntigravityCliVersion("0.9.0")).toBe(false);
    expect(isSupportedAntigravityCliVersion(null)).toBe(false);

    const rejectedCases = [
      { label: "generic ACP help text without agy acp", helpText: "Agent Client Protocol (ACP)", versionText: "1.5.14", versionExit: 0 },
      { label: "failed --version probe", helpText: "Usage: agy acp [flags]", versionText: "", versionExit: 1 },
      { label: "version below 1.5.0 (0.9.0)", helpText: "Usage: agy acp [flags]", versionText: "0.9.0", versionExit: 0 },
      { label: "version below 1.5.0 (1.4.9)", helpText: "Usage: agy acp [flags]", versionText: "1.4.9", versionExit: 0 },
    ];
    for (const entry of rejectedCases) {
      const dir = mkdtempSync(join(tmpdir(), "omb-agy-reject-"));
      scratch.push(dir);
      const { binPath } = writeFakeAgyCli(dir, entry);
      const pathWithNode = `${dir}${delimiter}${dirname(process.execPath)}`;
      await expect(resolveAntigravityRuntime(binPath, { PATH: pathWithNode }, dir), entry.label).rejects.toThrow();
    }

    const okDir = mkdtempSync(join(tmpdir(), "omb-agy-150-"));
    scratch.push(okDir);
    const { binPath } = writeFakeAgyCli(okDir, { helpText: "Usage: agy acp [flags]", versionText: "1.5.0" });
    const runtime = await resolveAntigravityRuntime(binPath, { PATH: `${okDir}${delimiter}${dirname(process.execPath)}` }, okDir);
    expect(runtime).toMatchObject({ kind: "cli", version: "1.5.0" });
  });

  it("prefers a verified v1.5+ agy on PATH over an installed managed 1.4.3 runtime, and falls back when absent or older", async () => {
    const asset = resolveAntigravityReleaseAsset();
    if (!asset) return;
    const baseDir = mkdtempSync(join(tmpdir(), "omb-agy-precedence-"));
    scratch.push(baseDir);
    const versionDir = join(baseDir, "tools", "antigravity-acp", `${process.platform}-${process.arch}`, "versions", asset.sha256);
    mkdirSync(versionDir, { recursive: true });
    for (const file of [asset.executable, asset.harness]) {
      const target = join(versionDir, file.name);
      writeFileSync(target, "");
      truncateSync(target, file.bytes);
      if (process.platform !== "win32") chmodSync(target, 0o755);
    }
    writeFileSync(join(versionDir, ".install-complete.json"), JSON.stringify({
      sha256: asset.sha256,
      version: asset.version,
      executable: asset.executable,
      harness: asset.harness,
    }));

    const cliDir = mkdtempSync(join(tmpdir(), "omb-agy-path-v15-"));
    scratch.push(cliDir);
    const { binPath } = writeFakeAgyCli(cliDir, { versionText: "1.5.14" });
    const pathWithV15 = `${cliDir}${delimiter}${dirname(process.execPath)}`;
    await expect(resolveAntigravityRuntime("agy", { PATH: pathWithV15 }, baseDir)).resolves.toMatchObject({
      executablePath: binPath,
      kind: "cli",
      source: "path",
      version: "1.5.14",
    });

    const oldDir = mkdtempSync(join(tmpdir(), "omb-agy-path-v14-"));
    scratch.push(oldDir);
    writeFakeAgyCli(oldDir, { versionText: "1.4.3" });
    const pathWithOld = `${oldDir}${delimiter}${dirname(process.execPath)}`;
    await expect(resolveAntigravityRuntime("agy", { PATH: pathWithOld }, baseDir)).resolves.toMatchObject({
      source: "managed",
      version: asset.version,
    });
    await expect(resolveAntigravityRuntime("agy", { PATH: "" }, baseDir)).resolves.toMatchObject({
      source: "managed",
      version: asset.version,
    });
  });

  it("fails closed when the session omits or lacks the requested permission mode, and never launches Full", async () => {
    expect(antigravityPermissionMode(false, "ask", [])).toBeNull();
    expect(antigravityPermissionMode(false, "edits", ["plan"])).toBeNull();
    expect(antigravityPermissionMode(false, "full", ["plan"])).toBeNull();
    expect(antigravityPermissionMode(true, undefined, ["plan"])).toBeNull();

    ensureDirs();
    for (const scenario of [
      { name: "missing-mode", modes: undefined, errorPattern: /did not advertise a permission mode/u },
      { name: "plan-only", modes: "plan", errorPattern: /does not advertise the requested permission mode/u },
    ]) {
      const dir = mkdtempSync(join(tmpdir(), `omb-agy-${scenario.name}-`));
      scratch.push(dir);
      const { binPath } = writeFakeAgyCli(dir);
      const dump = join(dir, "dump.json");
      const spawnedArgs: string[][] = [];
      const realSpawn = procs.spawnCli;
      const spawnSpy = vi.spyOn(procs, "spawnCli").mockImplementation((...args) => {
        spawnedArgs.push([...(args[1] ?? [])]);
        return realSpawn(...args);
      });

      const localInstance = await AntigravityDriver.create({
        instanceId: `antigravity-fail-closed-${scenario.name}`,
        displayName: "Google Gemini (Antigravity)",
        enabled: true,
        config: { cli: binPath, fullAuto: false },
        environment: {
          FAKE_ACP_AUTH_METHOD: "oauth-personal",
          FAKE_ACP_AGENT_NAME: "Antigravity ACP Server",
          FAKE_ACP_AGENT_VERSION: "1.5.14",
          FAKE_ACP_MODELS: "gemini-3.8-flash",
          ...(scenario.modes ? { FAKE_ACP_MODES: scenario.modes } : {}),
          FAKE_ACP_DUMP: dump,
          FAKE_ACP_DUMP_PROMPT: "1",
        },
      });
      const localRecorder = recordEvents(localInstance.adapter);
      try {
        await localInstance.startupModelRefresh;

        const fullTurn = await localInstance.adapter.sendTurn({
          threadId: `thread-full-${scenario.name}`,
          text: "hello full",
          approvalMode: "full",
          model: "gemini-3.8-flash",
          cwd: dir,
        });
        expect(await localRecorder.until((e) => e.type === "turn.completed" && e.turnId === fullTurn.turnId))
          .toMatchObject({ ok: false });
        expect(localRecorder.events.filter((e) => e.turnId === fullTurn.turnId))
          .toContainEqual(expect.objectContaining({ type: "runtime.error", message: expect.stringMatching(scenario.errorPattern) }));
        expect(spawnedArgs.some((args) => args.includes("--dangerously-skip-permissions"))).toBe(false);
        expect(existsSync(`${dump}.prompt.json`)).toBe(false);

        const askTurn = await localInstance.adapter.sendTurn({
          threadId: `thread-ask-${scenario.name}`,
          text: "hello ask",
          approvalMode: "ask",
          model: "gemini-3.8-flash",
          cwd: dir,
        });
        expect(await localRecorder.until((e) => e.type === "turn.completed" && e.turnId === askTurn.turnId))
          .toMatchObject({ ok: false });
        expect(localRecorder.events.filter((e) => e.turnId === askTurn.turnId))
          .toContainEqual(expect.objectContaining({ type: "runtime.error", message: expect.stringMatching(scenario.errorPattern) }));
        expect(existsSync(`${dump}.prompt.json`)).toBe(false);
        expect(existsSync(`${dump}.config.json`) ? JSON.parse(readFileSync(`${dump}.config.json`, "utf8")) : [])
          .not.toContainEqual(expect.objectContaining({ params: expect.objectContaining({ configId: "mode" }) }));
      } finally {
        spawnSpy.mockRestore();
        localRecorder.stop();
        await localInstance.dispose();
      }
    }
  }, 45_000);

  it("strips foreign provider API keys on both prepareAntigravityProfile and the CLI sign-in path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-agy-env-strip-"));
    scratch.push(dir);
    const { binPath } = writeFakeAgyCli(dir);
    const pathWithNode = `${dir}${delimiter}${dirname(process.execPath)}`;
    const runtime = await resolveAntigravityRuntime(binPath, { PATH: pathWithNode }, dir);

    const profile = await prepareAntigravityProfile({
      instanceId: "agy-cli-strip-keys",
      runtime,
      baseDir: dir,
      baseEnv: {
        PATH: process.env.PATH,
        GEMINI_API_KEY: "no-gemini",
        GOOGLE_API_KEY: "no-google",
        ANTHROPIC_API_KEY: "no-anthropic",
        OPENAI_API_KEY: "no-openai",
        DEEPSEEK_API_KEY: "no-deepseek",
        CURSOR_API_KEY: "no-cursor",
      },
    });
    for (const key of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "CURSOR_API_KEY"]) {
      expect(profile.environment[key], key).toBeUndefined();
    }

    const authenticate = vi.spyOn(AntigravityAuthController.prototype, "start").mockResolvedValue({
      phase: "succeeded", flowId: null, authorizationUrl: null, expiresAt: null,
    });
    instance = await AntigravityDriver.create({
      instanceId: "antigravity-cli-signin-strip",
      displayName: "Google Gemini (Antigravity)",
      enabled: true,
      config: { cli: binPath, fullAuto: false },
      environment: {
        ANTHROPIC_API_KEY: "foreign-anthropic",
        OPENAI_API_KEY: "foreign-openai",
        GEMINI_API_KEY: "foreign-gemini",
        GOOGLE_API_KEY: "foreign-google",
      },
    });
    await expect(instance.startAuthentication!()).resolves.toMatchObject({ phase: "succeeded" });
    const startedProfile = authenticate.mock.calls[0]![1];
    expect(startedProfile.environment.ANTHROPIC_API_KEY).toBeUndefined();
    expect(startedProfile.environment.OPENAI_API_KEY).toBeUndefined();
    expect(startedProfile.environment.GEMINI_API_KEY).toBeUndefined();
    expect(startedProfile.environment.GOOGLE_API_KEY).toBeUndefined();
  }, 30_000);
});
