// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  bots: [{ id: "pepper", name: "Pepper", section: "BI" }, { id: "fern", name: "Fern", section: "Support" }],
  api: vi.fn(async (_path: string) => ({ entries: [], total: 0, retentionDays: 180 })),
}));

vi.mock("@/state/store", () => ({ api: fixture.api }));
vi.mock("@/state/store-select", () => ({ useStoreSelector: (select: (state: typeof fixture) => unknown) => select(fixture) }));

import { ActivitySection } from "./ActivitySection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.useRealTimers());

it("opens on the linked bot and applies both filters to the list and CSV", async () => {
  vi.useFakeTimers();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(ActivitySection, { initialBot: "pepper" })));
    const bot = host.querySelector<HTMLSelectElement>('select[aria-label="Bot"]')!;
    const area = host.querySelector<HTMLSelectElement>('select[aria-label="Area"]')!;
    expect(bot.value).toBe("pepper");
    expect([...area.options].map((option) => option.text)).toEqual(["All areas", "BI", "Support"]);
    await act(async () => {
      area.value = "BI";
      area.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTimeAsync(250));
    expect(fixture.api).toHaveBeenCalledExactlyOnceWith("/api/admin-activity?bot=pepper&area=BI");
    expect(host.querySelector("a[download]")?.getAttribute("href")).toBe("/api/admin-activity.csv?bot=pepper&area=BI");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
