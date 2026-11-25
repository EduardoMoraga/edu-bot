// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ThemeFile } from "../../shared/theme";

const values = new Map<string, string>();
const puts: unknown[] = [];
let root: Root | null = null;

beforeEach(() => {
  values.clear();
  puts.length = 0;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal("fetch", (_input: unknown, init?: RequestInit) => {
    if (init?.method === "PUT") puts.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response("{}"));
  });
  vi.resetModules();
});

afterEach(() => {
  root?.unmount();
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.skin;
  delete document.documentElement.dataset.theme;
  document.documentElement.removeAttribute("style");
});

async function renderWearing(theme: ThemeFile, element: "ThemeRow" | "SkinPicker") {
  values.set("omb-skin", "midnight");
  const runtime = await import("@/lib/theme/runtime");
  runtime.startTheme();
  runtime.wearTheme({ id: "mine", theme });
  const component = element === "ThemeRow" ? (await import("./ThemeRow")).ThemeRow : (await import("./SkinPicker")).SkinPicker;
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  flushSync(() => root!.render(createElement(component, element === "ThemeRow" ? { simple: true } : {})));
  return runtime;
}

const pick = (name: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent?.trim() === name);
  if (!button) throw new Error(`no button ${name}`);
  flushSync(() => button.click());
};

it("Light shows at once over a custom theme with its own canvas, and the theme comes off for the person's other windows", async () => {
  const runtime = await renderWearing({ name: "Night", canvas: "#0b1020", accent: "#ff2bd6" }, "ThemeRow");
  expect(document.documentElement.dataset.theme).toBe("mine");
  pick("Light");
  expect(document.documentElement.dataset.skin).toBe("daylight");
  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(document.documentElement.style.getPropertyValue("--color-app")).toBe("");
  expect(runtime.wornTheme()).toBeNull();
  expect(puts).toContainEqual({ id: null });
});

it("Dark keeps a theme with its own light and dark colours, which follows the choice", async () => {
  const runtime = await renderWearing({ name: "Both", light: { canvas: "#ffffff" }, dark: { canvas: "#121212" } }, "ThemeRow");
  values.set("omb-skin", "daylight");
  pick("Dark");
  expect(document.documentElement.dataset.skin).toBe("midnight");
  expect(runtime.wornTheme()?.id).toBe("mine");
  expect(puts).toEqual([]);
});

it("a skin from the grid shows over any custom theme", async () => {
  const runtime = await renderWearing({ name: "Both", light: { canvas: "#ffffff" }, dark: { canvas: "#121212" } }, "SkinPicker");
  pick("LagoonCool daylight. Porcelain and deep teal.");
  expect(document.documentElement.dataset.skin).toBe("lagoon");
  expect(runtime.wornTheme()).toBeNull();
});

it("a skin a bot sets for the window shows over a custom theme too", async () => {
  const runtime = await renderWearing({ name: "Night", canvas: "#0b1020" }, "ThemeRow");
  const { applyWindowPref } = await import("@/lib/window-prefs");
  applyWindowPref({ kind: "window-pref", id: "appearance.skin", value: "lagoon" });
  expect(document.documentElement.dataset.skin).toBe("lagoon");
  expect(runtime.wornTheme()).toBeNull();
});

it("Light shows over a theme being edited, not only over the one in use", async () => {
  values.set("omb-skin", "midnight");
  const runtime = await import("@/lib/theme/runtime");
  runtime.startTheme();
  runtime.previewTheme({ id: "draft", theme: { name: "Draft", canvas: "#0b1020" } });
  const { ThemeRow } = await import("./ThemeRow");
  root = createRoot(document.body.appendChild(document.createElement("div")));
  flushSync(() => root!.render(createElement(ThemeRow, { simple: true })));
  pick("Light");
  expect(document.documentElement.dataset.skin).toBe("daylight");
  expect(document.documentElement.dataset.theme).toBeUndefined();
});
