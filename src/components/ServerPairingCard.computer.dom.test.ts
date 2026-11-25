// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";

const paired = vi.hoisted(() => ({ sessions: [] as Array<{ id: string; label: string; scopes: string[]; lastSeenAt: number; expiresAt: number }>, reads: 0, fails: false }));
vi.mock("@/state/store", () => ({
  api: async (path: string) => {
    if (path === "/api/auth/pairing") return { code: "ABCD-EFGH-IJKL", expiresAt: Date.now() + 600_000, url: "http://macmini.tail1234.ts.net:8799/pair#code=ABCD-EFGH-IJKL" };
    if (path === "/api/config") return {};
    paired.reads += 1;
    if (paired.fails) throw new Error("offline");
    return { sessions: paired.sessions, current: null };
  },
}));
vi.mock("../lib/session", async (original) => ({
  ...await original<typeof import("../lib/session")>(),
  readSessionState: async () => ({ kind: "loopback" }),
}));
const { ServerPairingCard, computerLink, PAIRED_REFRESH_MS } = await import("./ServerPairingCard");

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setLocale("en");
  Object.assign(paired, { sessions: [], reads: 0, fails: false });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
});

async function openDialog(forComputer: boolean) {
  flushSync(() => root.render(createElement(ServerPairingCard, { simple: true, reveal: false, forComputer, address: forComputer ? "http://macmini.tail1234.ts.net:8799" : null })));
  const button = await vi.waitFor(() => {
    const found = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").startsWith("Pair a"));
    expect(found).toBeDefined();
    return found!;
  });
  const label = button.textContent;
  const rowText = host.textContent ?? "";
  button.click();
  const dialog = await vi.waitFor(() => {
    const found = document.querySelector("[data-pair-dialog='code']");
    expect(found).not.toBeNull();
    return found!;
  });
  return {
    label, rowText, dialog, title: dialog.getAttribute("aria-label"), text: dialog.querySelector("[data-pair-instructions]")?.textContent ?? "",
    qr: dialog.querySelector("[data-pair-qr]") !== null, all: dialog.textContent ?? "",
    buttons: [...dialog.querySelectorAll("button")].filter((b) => b.textContent).map((b) => ({ text: b.textContent, primary: b.classList.contains("ui-button-primary") })),
  };
}

it("shows another computer the address with the code, and makes Copy link the main button", async () => {
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const computer = await openDialog(true);
  expect(computer.label).toBe("Pair a computer");
  expect(computer.rowText).toContain("Pair another computer");
  expect(computer.rowText).not.toMatch(/phone/i);
  expect(computer.title).toBe("Pair another computer");
  expect(computer.text).toBe("On your other computer, open Edu Bot, then Settings → This app → Your computers → Connect to a server. Paste the link you copy here, or type this address and code there.");
  expect(computer.dialog.querySelector("[data-pairing-address]")?.textContent).toBe("http://macmini.tail1234.ts.net:8799");
  expect(computer.dialog.querySelector("[data-pairing-code]")?.textContent).toBe("ABCD-EFGH-IJKL");
  expect(computer.qr).toBe(false);
  expect(computer.all).not.toMatch(/phone|scan/i);
  expect(computer.buttons).toEqual([{ text: "Done", primary: false }, { text: "Copy link", primary: true }]);
  computer.dialog.querySelector<HTMLButtonElement>("[data-copy-link]")!.click();
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("http://macmini.tail1234.ts.net:8799/pair#code=ABCD-EFGH-IJKL"));
});

it("makes the link from the shared address when the server gave none", () => {
  expect(computerLink({ url: null, code: "ABCD-EFGH-IJKL" }, "https://macmini.tail1234.ts.net")).toEqual({ link: "https://macmini.tail1234.ts.net/pair#code=ABCD-EFGH-IJKL", address: "https://macmini.tail1234.ts.net" });
  expect(computerLink({ url: null, code: "ABCD-EFGH-IJKL" }, null)).toBeNull();
});

it("keeps the phone wording for phones", async () => {
  const phone = await openDialog(false);
  expect(phone.label).toBe("Pair a phone");
  expect(phone.text).toContain("on your phone");
  expect(phone.qr).toBe(true);
  expect(phone.dialog.querySelector("[data-pairing-address]")).toBeNull();
  expect(phone.buttons).toEqual([{ text: "Copy link", primary: false }, { text: "Done", primary: true }]);
});

it("lists a computer that just used its code without leaving the page, and stops reading when the card closes", async () => {
  vi.useFakeTimers();
  try {
    const card = (forComputer: boolean) => createElement(ServerPairingCard, { simple: true, reveal: false, forComputer, address: forComputer ? "http://macmini.tail1234.ts.net:8799" : null });
    flushSync(() => root.render(card(true)));
    await vi.advanceTimersByTimeAsync(10);
    expect(paired.reads).toBe(1);
    expect(host.textContent).not.toContain("FFM-EDUARDOMORAGA");

    paired.sessions = [{ id: "s1", label: "FFM-EDUARDOMORAGA", scopes: ["admin", "client"], lastSeenAt: Date.now(), expiresAt: Date.now() + 86_400_000 }];
    await vi.advanceTimersByTimeAsync(PAIRED_REFRESH_MS);
    expect(paired.reads).toBe(2);
    await vi.waitFor(() => expect(host.textContent).toContain("FFM-EDUARDOMORAGA"));

    paired.fails = true;
    await vi.advanceTimersByTimeAsync(PAIRED_REFRESH_MS);
    expect(paired.reads).toBe(3);
    await vi.advanceTimersByTimeAsync(10);
    expect(host.textContent, "a refresh that fails says nothing").not.toContain("offline");
    expect(host.textContent).toContain("FFM-EDUARDOMORAGA");

    flushSync(() => root.render(createElement("div")));
    await vi.advanceTimersByTimeAsync(PAIRED_REFRESH_MS * 3);
    expect(paired.reads).toBe(3);

    flushSync(() => root.render(card(false)));
    await vi.advanceTimersByTimeAsync(10);
    const afterMount = paired.reads;
    await vi.advanceTimersByTimeAsync(PAIRED_REFRESH_MS * 3);
    expect(paired.reads, "the phone's card keeps reading once").toBe(afterMount);
  } finally {
    vi.useRealTimers();
  }
});
