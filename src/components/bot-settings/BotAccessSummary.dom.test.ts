// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import { setLocale } from "@/lib/i18n";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), admin: true }));

vi.mock("@/state/store-select", () => ({ useStoreDispatch: () => fixture.dispatch }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => fixture.admin }));
vi.mock("@/lib/mcp-servers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mcp-servers")>()),
  useMcpServers: () => ({ servers: [{ name: "catalog", enabled: true }, { name: "notes", enabled: true }], error: false }),
}));
vi.mock("./useBotApps", () => ({
  useBotApps: () => ({ phase: "ready", apps: [{ label: "Gmail", scope: "read" }, { label: "Slack", scope: null }] }),
}));

import { BotAccessSummary } from "./BotAccessSummary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bot = {
  id: "pepper", approvalMode: "full", approvalCeiling: "ask", mcpServers: ["catalog"],
  toolScope: { allow: ["Read"], deny: ["Bash"] }, dataConnections: { sales: { schemas: ["public"], tables: ["orders"] } },
} as unknown as Bot;

afterEach(() => {
  fixture.admin = true;
  setLocale("en");
});

it("shows the approval limit and named grants, then opens activity for this bot", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(BotAccessSummary, { bot })));
    const text = host.textContent!;
    expect(text).toContain("The default is Ask for approval. This area allows at most Ask for approval.");
    for (const granted of ["Read", "Bash", "catalog", "Gmail", "sales", "orders", "public"]) expect(text).toContain(granted);
    for (const excluded of ["Full access", "notes", "Slack"]) expect(text).not.toContain(excluded);
    await act(async () => host.querySelector("button")!.click());
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "activity", activityBot: "pepper" });

    fixture.admin = false;
    setLocale("es");
    await act(async () => root.render(createElement(BotAccessSummary, { bot })));
    expect(host.textContent).toContain("Qué puede usar este bot");
    expect(host.textContent).toContain("En sales, este bot puede leer orders.");
    expect(host.querySelector("button")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
