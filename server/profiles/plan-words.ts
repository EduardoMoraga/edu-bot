import type { ApprovalCeiling } from "../../shared/approval-mode.ts";
import { serverLine, type ServerLineKey } from "../server-lines.ts";

type ProfileLineKey = Extract<ServerLineKey, `server.profiles.${string}`>;

/** A profile plan's words in `language` (undefined reads as English). */
export type PlanSay = (key: ProfileLineKey, params?: Readonly<Record<string, string | number>>) => string;

export const planSay = (language: string | undefined): PlanSay => (key, params) => serverLine(language, key, params);

export const ENGLISH_PLAN: PlanSay = planSay(undefined);

export function sayList(say: PlanSay, names: readonly string[]): string {
  return names.length < 2 ? names.join("") : say("server.profiles.and", { rest: names.slice(0, -1).join(", "), last: names.at(-1)! });
}

export const sayLines = (say: PlanSay, count: number) => say(count === 1 ? "server.profiles.lines.one" : "server.profiles.lines.many", { count });

const APPROVAL: Readonly<Record<string, ProfileLineKey>> = {
  ask: "server.profiles.approval.ask", edits: "server.profiles.approval.edits", auto: "server.profiles.approval.auto",
  full: "server.profiles.approval.full", custom: "server.profiles.approval.custom",
};

export const sayApproval = (say: PlanSay, mode: string) => (Object.hasOwn(APPROVAL, mode) ? say(APPROVAL[mode]!) : mode);

/** "Ask for approval" for ask, the level's own name otherwise. */
export const sayApprovalPhrase = (say: PlanSay, mode: string) => (mode === "ask" ? say("server.profiles.approval.askPhrase") : sayApproval(say, mode));

const CEILING: Readonly<Record<ApprovalCeiling, ProfileLineKey>> = {
  ask: "server.profiles.ceiling.ask", edits: "server.profiles.ceiling.edits", auto: "server.profiles.ceiling.auto", full: "server.profiles.ceiling.full",
};

export const sayCeiling = (say: PlanSay, ceiling: ApprovalCeiling) => say(CEILING[ceiling]);
