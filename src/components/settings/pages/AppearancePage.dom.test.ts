// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ThemeFile } from "../../../../shared/theme";
import type { SettingsContext } from "../settings-index";

const values = new Map<string, string>();
const saved = new Map<string, ThemeFile>();
let active: string | null = null;
const requests: string[] = [];
let root: Root | null = null;

const SIMPLE: SettingsContext = {
  desktop: false, here: true, home: true, cloud: false, team: false, client: true, admin: true, places: false, plan: false,
  organization: false, environments: false, installations: false, skills: false, advanced: false,
};

function respond(path: string, init?: RequestInit): unknown {
  const method = init?.method ?? "GET";
  requests.push(`${method} ${path}`);
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  if (path === "/api/themes") return { themes: [...saved].map(([id, theme]) => ({ id, name: theme.name, assets: [] })) };
  if (path === "/api/themes/history") return { items: [] };
  if (path === "/api/themes/active") {
    if (method === "PUT") active = body.id;
    return { id: active, theme: active ? saved.get(active) : null };
  }
  const id = path.replace("/api/themes/", "");
  if (method === "PUT") saved.set(id, body.theme);
  return { id, theme: saved.get(id) };
}

beforeEach(() => {
  values.clear();
  saved.clear();
  active = null;
  requests.length = 0;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(respond(String(input).replace(/^https?:\/\/[^/]+/, ""), init)))));
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

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

async function renderAppearance(ctx: SettingsContext = SIMPLE) {
  const { SettingsShellContext } = await import("../settings-shell");
  const { AppearancePage } = await import("./AppPages");
  const runtime = await import("@/lib/theme/runtime");
  runtime.startTheme();
  const shell = { ctx, place: { kind: "computer", name: "This computer" }, page: "appearance", anchor: null, go: () => {} };
  root = createRoot(document.body.appendChild(document.createElement("div")));
  flushSync(() => root!.render(createElement(SettingsShellContext.Provider, { value: shell as never }, createElement(AppearancePage))));
  await settle();
  return runtime;
}

const button = (name: string) => {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((each) => each.textContent?.trim() === name);
  if (!found) throw new Error(`no button ${name}`);
  return found;
};
const click = async (name: string) => { flushSync(() => button(name).click()); await settle(); };
const type = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
  flushSync(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const colorInput = (name: string) => document.querySelector<HTMLInputElement>(`input[type="color"][aria-label="${name}"]`)!;
const editor = () => document.querySelector<HTMLElement>('[data-settings-block="theme-editor"]');

it("shows every skin in Simple mode, so Light or dark is not the only way to change the look", async () => {
  await renderAppearance();
  const grid = document.querySelector('[data-settings-block="themes"]');
  expect(grid).not.toBeNull();
  expect(grid!.querySelectorAll('[role="radio"], [aria-pressed]').length).toBeGreaterThan(3);
  expect(button("Hide themes").getAttribute("aria-expanded")).toBe("true");
});

it("shows Font and Chat width in Simple mode", async () => {
  await renderAppearance();
  const chat = document.querySelector('[data-settings-block="chat"]');
  expect(chat?.textContent).toContain("Interface font");
  expect(chat?.textContent).toContain("Chat width");
});

it("a new theme shows its colours as not set, previews edits live, and Save puts it in use", async () => {
  saved.set("mine", { name: "Mine" });
  const runtime = await renderAppearance();
  await click("Edit");
  expect(editor()).not.toBeNull();
  expect(editor()!.textContent).toContain("Not set");
  expect(editor()!.textContent).not.toContain("#121212");
  expect(editor()!.textContent).not.toContain("#1084fe");

  type(colorInput("Background"), "#204060");
  expect(editor()!.textContent).toContain("#204060");
  expect(document.documentElement.dataset.theme, "the window shows the edit before it is saved").toBe("mine");
  expect(runtime.wornTheme()).toBeNull();

  await click("Save and use");
  expect(saved.get("mine")).toMatchObject({ canvas: "#204060" });
  expect(active).toBe("mine");
  expect(runtime.wornTheme()?.id).toBe("mine");
  expect(editor()!.textContent).toContain("Saved. In use now.");
  expect(button("Save")).toBeTruthy();
});

it("keeps unsaved edits through a stray click elsewhere, and Cancel lets them go and the preview with them", async () => {
  saved.set("one", { name: "One" });
  saved.set("two", { name: "Two" });
  await renderAppearance();
  const editButtons = () => [...document.querySelectorAll<HTMLButtonElement>("button")].filter((each) => each.textContent === "Edit");
  flushSync(() => editButtons()[0]!.click());
  await settle();
  type(colorInput("Accent"), "#ff2bd6");
  flushSync(() => editButtons()[0]!.click());
  await settle();
  expect(document.body.textContent).toContain("Unsaved changes");
  expect(document.documentElement.dataset.theme).toBe("two");

  flushSync(() => button("Cancel").click());
  await settle();
  flushSync(() => editButtons()[0]!.click());
  await settle();
  expect(editor()!.textContent).toContain("#ff2bd6");
  flushSync(() => button("Cancel").click());
  await settle();
  expect(document.body.textContent).not.toContain("Unsaved changes");
  expect(document.documentElement.dataset.theme).toBeUndefined();
  expect(saved.get("one")).toEqual({ name: "One" });
});
