// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo } from "@/state/store";

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  const value = { state: { ...original.initialState, instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo] }, dispatch: vi.fn(), flushBotPatches: vi.fn() };
  return { ...original, useStore: () => value };
});
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false, reasonCode: "cua-driver-unavailable", message: "" } }, ready: true }),
}));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => createElement("span") }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: () => createElement("span") }));

const { ChatView } = await import("./ChatView");
const { loadLocale, setLocale, t } = await import("@/lib/i18n");

const bot: Bot = {
  id: "bot", threadId: "t1", name: "Pepper", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "test", model: "m" },
};
let root: Root;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const labels = () => [...document.querySelectorAll("button, textarea")].map((element) => element.getAttribute("aria-label") ?? "");

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

it("draws its header again in a language that arrives after it first drew", async () => {
  flushSync(() => root.render(createElement(ChatView, { bot })));
  await settle();
  const profile = t("chat.openProfileAria", { name: "Pepper" }), screen = t("chat.computer");
  expect(profile).toBe("Open Pepper's profile");
  expect(labels()).toContain(profile);
  expect(labels()).toContain(screen);

  expect(await loadLocale("es")).toBe("es");
  await settle();
  expect(t("chat.openProfileAria", { name: "Pepper" })).not.toBe(profile);
  expect(labels()).toContain(t("chat.openProfileAria", { name: "Pepper" }));
  expect(labels()).toContain(t("chat.computer"));
  expect(labels()).not.toContain(profile);
});
