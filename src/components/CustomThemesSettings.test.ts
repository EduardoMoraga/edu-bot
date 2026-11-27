// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { CustomThemesSettings, themeFileName } from "./CustomThemesSettings";

const fixture = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/api", () => ({ api: fixture.api }));

const THEME = { version: 1, theme: { name: "Neon", accent: "#ff00aa" }, assets: {} };
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setLocale("en");
  fixture.api.mockReset();
  fixture.api.mockImplementation(async (path: string) => {
    if (path === "/api/themes") return { themes: [] };
    if (path === "/api/themes/history") return { items: [] };
    if (path === "/api/themes/import") return { ok: true };
    throw new Error(`unexpected ${path}`);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function importNamed(name: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { configurable: true, value: [new File([JSON.stringify(THEME)], name, { type: "application/json" })] });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

describe("theme files", () => {
  it("exports as <id>.edubot-theme.json", () => {
    expect(themeFileName("neon")).toBe("neon.edubot-theme.json");
  });

  it("imports a theme file by its content, under its new name or the one older exports carry", async () => {
    await act(async () => root.render(createElement(CustomThemesSettings)));
    const accept = host.querySelector<HTMLInputElement>('input[type="file"]')!.accept.split(",");
    expect(accept).toEqual(expect.arrayContaining([".json", ".edubot-theme.json", ".mausbot-theme.json"]));
    for (const name of ["neon.edubot-theme.json", "neon.mausbot-theme.json"]) {
      fixture.api.mockClear();
      await importNamed(name);
      const imports = fixture.api.mock.calls.filter(([path]) => path === "/api/themes/import");
      expect(imports, name).toHaveLength(1);
      expect(JSON.parse(imports[0]![1].body), name).toEqual(THEME);
    }
  });
});
