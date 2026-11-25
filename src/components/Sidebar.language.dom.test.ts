// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo } from "@/state/store";

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => true }));
vi.mock("@/lib/interface-mode", async (original) => ({ ...await original<typeof import("@/lib/interface-mode")>(), useAdvancedMode: () => false }));

const { Sidebar } = await import("./Sidebar");
const { BotEditorStore, initialState } = await import("@/state/store");
const { loadLocale, setLocale } = await import("@/lib/i18n");
const en = (await import("../locales/en.json")).default;
const es = (await import("../locales/es.json")).default;

const atlas: Bot = {
  id: "atlas", threadId: "t", name: "Atlas", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "test", model: "m" },
};
const state: AppState = {
  ...initialState, connected: true, selectedId: "atlas", activeView: "chat", bots: [atlas],
  instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" } } as InstanceInfo],
};
let root: Root;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const labels = () => [...document.querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "");

beforeAll(() => {
  vi.stubGlobal("fetch", () => new Promise(() => {}));
  setLocale("en");
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterAll(() => {
  root.unmount();
  setLocale("en");
  vi.unstubAllGlobals();
});

it("draws again in a language that arrives after it first drew, with no other change to redraw it", async () => {
  const value = { state, dispatch: vi.fn(), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(Sidebar, { open: true, onClose: () => {} }) })));
  await settle();
  expect(labels()).toContain(en["sidebar.connectApps"]);
  expect(labels()).toContain(en["sidebar.newOrShare"]);

  expect(await loadLocale("es")).toBe("es");
  await settle();
  expect(labels()).toContain(es["sidebar.connectApps"]);
  expect(labels()).toContain(es["sidebar.newOrShare"]);
  expect(labels()).not.toContain(en["sidebar.connectApps"]);
});
