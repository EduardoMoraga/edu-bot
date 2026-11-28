import { describe, expect, it, vi } from "vitest";

import { createComputerAllow } from "./computer-allow.mjs";

const FFM = { id: "ffm-eduardomoraga.tail9f9734.ts.net", name: "FFM-EDUARDOMORAGA", os: "windows", status: "eduBot", version: "0.3.1", platform: "win32",
  address: "http://ffm-eduardomoraga.tail9f9734.ts.net:8799", trust: true };
const OLD = { ...FFM, id: "old.tail9f9734.ts.net", name: "OLD", address: "http://old.tail9f9734.ts.net:8799", trust: false };
const OFF = { id: "mac.tail9f9734.ts.net", name: "Mac", os: "macOS", status: "offline" };
const FOLDER = { id: "5f3c8a52-7f5e-4b8e-9d0e-2a7c4f6b1d90", path: "C:\\Users\\eduardo\\EduBotPrueba", name: "EduBotPrueba", write: false };
const t = (key, params = {}) => `${key}${Object.keys(params).length ? ` ${JSON.stringify(params)}` : ""}`;

function rig({ status = 200, folder = FOLDER, computers = [FFM, OLD, OFF] } = {}) {
  const saved = [];
  const grants = new Map();
  const fetch = vi.fn(async () => new Response(null, { status }));
  const sharing = {
    state: (id) => grants.get(id) ?? { enabled: false, folders: [] },
    lendOwn: vi.fn(async (env, grant) => { grants.set(env.id, { enabled: true, ...grant }); }),
    revoke: vi.fn(async (env) => { grants.set(env.id, { enabled: false, folders: [] }); }),
  };
  const environments = {
    byHost: (host) => saved.find((env) => new URL(env.origin).hostname === host) ?? null,
    save: ({ origin, name }) => {
      const env = saved.find((entry) => entry.origin === origin) ?? { id: `env-${saved.length + 1}`, origin, name };
      if (!saved.includes(env)) saved.push(env);
      return env;
    },
  };
  const chooseFolder = vi.fn(async () => folder);
  const allow = createComputerAllow({ list: async () => ({ tailscale: "ready", computers }), fetch, label: "MAC-MINI", platform: "darwin", environments, sharing, chooseFolder, t });
  return { allow, fetch, sharing, saved, chooseFolder };
}

describe("Always allow", () => {
  it("asks for one folder, signs in by Tailscale, and lends only that folder: never the terminal or the screen", async () => {
    const { allow, fetch, sharing, saved, chooseFolder } = rig();
    await expect(allow.allow(FFM.id)).resolves.toBe(true);
    expect(chooseFolder).toHaveBeenCalledWith("FFM-EDUARDOMORAGA");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("http://ffm-eduardomoraga.tail9f9734.ts.net:8799/api/auth/tailnet");
    expect(init).toMatchObject({ method: "POST", credentials: "include", redirect: "error", headers: { "content-type": "application/json" } });
    expect(JSON.parse(init.body)).toEqual({ label: "MAC-MINI", platform: "darwin", cookie: true });
    expect(saved).toEqual([{ id: "env-1", origin: FFM.address, name: "FFM-EDUARDOMORAGA" }]);
    expect(sharing.lendOwn).toHaveBeenCalledWith(saved[0], { folders: [FOLDER], terminal: false, computer: false });
    const rows = await allow.rows();
    expect(rows.computers.find((row) => row.id === FFM.id)).toMatchObject({ allowed: true, folders: ["EduBotPrueba"] });
    expect(rows.computers.find((row) => row.id === OLD.id)).toMatchObject({ allowed: false });
  });

  it("lends nothing and signs in nowhere when no folder is picked", async () => {
    const { allow, fetch, sharing, saved } = rig({ folder: null });
    await expect(allow.allow(FFM.id)).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(sharing.lendOwn).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it("lends nothing when that computer refuses the Tailscale sign-in", async () => {
    const { allow, sharing, saved } = rig({ status: 403 });
    await expect(allow.allow(FFM.id)).rejects.toThrow("native.computers.refused");
    expect(sharing.lendOwn).not.toHaveBeenCalled();
    expect(saved).toEqual([]);
  });

  it("allows only a computer it found itself with an Edu Bot that signs in by Tailscale", async () => {
    const { allow, fetch, chooseFolder } = rig();
    await expect(allow.allow(OLD.id)).rejects.toThrow("native.computers.update");
    await expect(allow.allow(OFF.id)).rejects.toThrow("native.computers.notThere");
    await expect(allow.allow("evil.example.com")).rejects.toThrow("native.computers.notThere");
    expect(chooseFolder).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("stops lending to it, online or not", async () => {
    const { allow, sharing, saved } = rig();
    await allow.allow(FFM.id);
    await allow.stop(FFM.id);
    expect(sharing.revoke).toHaveBeenCalledWith(saved[0]);
    expect((await allow.rows()).computers.find((row) => row.id === FFM.id)).toMatchObject({ allowed: false });
    await allow.stop("never-allowed.tail9f9734.ts.net");
    expect(sharing.revoke).toHaveBeenCalledTimes(1);
  });

  it("answers only the desktop window's own page", async () => {
    const handlers = new Map();
    const { allow } = rig();
    const localOnly = vi.fn((channel, handler) => handler);
    allow.install({ handle: (channel, handler) => handlers.set(channel, handler) }, localOnly);
    expect([...handlers.keys()]).toEqual(["companion:computers", "companion:computer-allow", "companion:computer-stop"]);
    expect(localOnly.mock.calls.map(([channel]) => channel)).toEqual([...handlers.keys()]);
  });
});
