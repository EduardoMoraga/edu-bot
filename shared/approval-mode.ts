import { levelWithin, type ApprovalMode } from "../packages/phone-protocol/src/approval-mode.ts";

export type ApprovalCeiling = Exclude<ApprovalMode, "custom">;

const ceilingNames: Record<ApprovalCeiling, string> = {
  ask: "Ask for approval", edits: "Auto-accept edits", auto: "Approve for me", full: "Full access",
};

export function withinApprovalCeiling(mode: ApprovalMode, ceiling?: ApprovalCeiling): ApprovalMode {
  if (!ceiling || levelWithin(mode, ceiling)) return mode;
  return mode === "custom" ? "ask" : ceiling;
}

export const approvalCeilingMessage = (ceiling: ApprovalCeiling) => `This area allows at most ${ceilingNames[ceiling]}`;

export * from "../packages/phone-protocol/src/approval-mode.ts";
