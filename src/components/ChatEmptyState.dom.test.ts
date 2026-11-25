// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppState, Bot, InstanceInfo } from "@/state/store";

const access = vi.hoisted(() => ({ canWrite: true, ownerOrAdmin: true as boolean | null }));
vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({ capabilities: { dictation: { available: false }, host: { packaged: true, platform: "other" }, localComputer: { available: false } }, ready: true }),
}));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => access.canWrite, useReactor: () => "user" }));
vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => access.ownerOrAdmin }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));

const { ChatView } = await import("./ChatView");
const { BotEditorStore, initialState } = await import("@/state/store");

const pepper: Bot = {
  id: "pepper", threadId: "pepper-thread", name: "Pepper", title: "", description: "", soul: "", color: "green",
  notifications: true, unread: false, busy: false, messages: [], modelSelection: { instanceId: "test", model: "m" },
  tasks: [{ threadId: "pepper-thread", title: "Thread", createdAt: 1, busy: false, activity: "idle", modelSelection: { instanceId: "test", model: "m" }, approvalMode: "ask" }],
};

const sent: Array<{ url: string; init?: RequestInit }> = [];
const dispatch = vi.fn();
let root: Root;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function draw(bot: Bot = pepper) {
  const state: AppState = {
    ...initialState, connected: true, selectedId: bot.id, bots: [bot],
    instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test", snapshot: { state: "available" }, capabilities: { agentsMcp: true } } as InstanceInfo],
  };
  const value = { state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
  flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(ChatView, { bot }) })));
  await settle();
}
const empty = () => document.querySelector<HTMLElement>("[data-chat-empty]");
const suggestions = () => [...document.querySelectorAll<HTMLButtonElement>("[data-chat-suggestion]")];
const composer = () => document.querySelector<HTMLTextAreaElement>("textarea")!;

beforeAll(() => {
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), init });
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
  });
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
beforeEach(() => {
  access.canWrite = true;
  access.ownerOrAdmin = true;
  dispatch.mockClear();
});
afterAll(() => {
  root.unmount();
  vi.unstubAllGlobals();
});

describe("a chat with no messages yet", () => {
  it("shows the Edu drawing with no mascot, the bot's name, four things to ask and New bot", async () => {
    await draw();
    expect(empty()?.querySelector("svg[data-empty-chat-art]")?.getAttribute("aria-hidden")).toBe("true");
    expect(empty()?.querySelector("[data-avatar]")).toBeNull();
    expect(empty()?.textContent).toContain("Pepper");
    expect(suggestions().map((button) => button.textContent)).toEqual([
      "Summarize a document for me", "Help me write an email", "Plan my week with me", "Explain a topic in plain words",
    ]);
    expect(empty()?.querySelector("[role=group]")?.getAttribute("aria-label")).toBe("Ideas to start");
    expect(empty()?.querySelector("[data-chat-new-bot]")?.textContent).toBe("New bot");
  });

  it("fills the composer with a suggestion without sending it, and does not stack the same one twice", async () => {
    await draw({ ...pepper, id: "fill", threadId: "fill-thread" });
    sent.length = 0;
    flushSync(() => suggestions()[1]!.click());
    await settle();
    expect(composer().value).toBe("Help me write an email");
    flushSync(() => suggestions()[1]!.click());
    await settle();
    expect(composer().value).toBe("Help me write an email");
    expect(sent.filter((call) => call.init?.method === "POST")).toEqual([]);
    expect(empty()).not.toBeNull();
  });

  it("opens the New bot flow from its button", async () => {
    await draw();
    flushSync(() => empty()!.querySelector<HTMLButtonElement>("[data-chat-new-bot]")!.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "newBot" });
  });

  it("leaves out the things to ask where the person cannot write, and New bot for a member who may not add bots", async () => {
    access.canWrite = false;
    access.ownerOrAdmin = false;
    await draw({ ...pepper, id: "guest", threadId: "guest-thread" });
    expect(empty()).not.toBeNull();
    expect(suggestions()).toEqual([]);
    expect(empty()!.querySelector("[data-chat-new-bot]")).toBeNull();
  });
});
