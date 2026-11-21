import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import type { Message, OptionCardData } from "@/state/store";
import { liveCardKind } from "../../shared/live-approval";

vi.mock("@/lib/use-owner-or-admin", () => ({ useOwnerOrAdmin: () => true }));

const { ApprovalCard, approvalCardOutcome, titledCard, titledCardAction, titledCardTitle } = await import("./ApprovalCard");
const { PendingApprovalActions, PendingApprovalPanel, pendingApprovals } = await import("./PendingApproval");

const card = (patch: Partial<OptionCardData> = {}, global = false): OptionCardData => ({
  title: "Save to Luna's Edu brain?", subtitle: "English fallback", options: ["Approve", "Reject"], requestId: "edu-1", tool: "edu_propose_canonical",
  eduProposal: { id: "K-iso", title: "Use ISO dates", kind: "standard", band: "verified", why: "needs human confirmation", brain: "/data/brains/luna", global, body: "Dates as YYYY-MM-DD." },
  ...patch,
});
const message = (value: OptionCardData): Message => ({ id: "m1", role: "bot", kind: "options", at: 1, card: value });

it("draws the proposal as a titled card with its note, kind, band and brain", () => {
  const html = renderToStaticMarkup(createElement(ApprovalCard, { bot: { name: "Luna" }, message: message(card()), threadId: "t1" }));
  expect(titledCard(card())).toBe(true);
  expect(html).toContain("Save to Luna&#x27;s Edu brain?");
  expect(html).toContain("Use ISO dates");
  expect(html).toContain("standard · verified · needs human confirmation");
  expect(html).toContain("Dates as YYYY-MM-DD.");
  expect(html).toContain("Brain: /data/brains/luna");
  expect(html).not.toContain("global Edu brain");
  expect(html).toContain("Waiting for your confirmation below");
});

it("says when approving changes the global brain", () => {
  const global = card({}, true);
  expect(titledCardTitle(global, "Luna")).toBe("Save to your global Edu brain?");
  const html = renderToStaticMarkup(createElement(ApprovalCard, { bot: { name: "Luna" }, message: message(global), threadId: "t1" }));
  expect(html).toContain("Global brain: /data/brains/luna");
  expect(html).toContain("Approving changes your global Edu brain, which every coding CLI with Edu reads.");
});

it("offers Approve and Reject below the chat, and never to the voice", () => {
  const [pending] = pendingApprovals([message(card())]);
  expect(pending).toBeDefined();
  expect(titledCardAction(card())).toBe("Approve");
  const panel = renderToStaticMarkup(createElement(PendingApprovalPanel, { pending: pending!, count: 1, index: 0, botName: "Luna" }));
  expect(panel).toContain("Save to Luna&#x27;s Edu brain?");
  expect(panel).toContain("Dates as YYYY-MM-DD.");
  expect(liveCardKind(card())).toBe("review");
});

it("words each ending", () => {
  expect(approvalCardOutcome(card({ answered: "allow" }))).toBe("Saved to the Edu brain");
  expect(approvalCardOutcome(card({ answered: "deny" }))).toBe("Rejected");
  expect(approvalCardOutcome(card({ answered: "unavailable", dismissed: true }))).toBe("Already decided elsewhere");
  expect(approvalCardOutcome(card())).toBeUndefined();
});

it("labels the answers Reject and Approve", async () => {
  const { StoreContext } = await import("@/state/store");
  const [pending] = pendingApprovals([message(card())]);
  const html = renderToStaticMarkup(createElement(StoreContext.Provider, { value: { state: {}, dispatch: () => {} } as never },
    createElement(PendingApprovalActions, { pending: pending!, threadId: "t1", onCancelTurn: () => {} })));
  expect(html).toContain(">Reject<");
  expect(html).toContain(">Approve<");
});
