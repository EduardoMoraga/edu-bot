import { approvalModeFor, levelWithin, supportsApprovalMode, withinApprovalCeiling, type ApprovalCeiling, type ApprovalMode } from "../../shared/approval-mode.ts";
import { DATA_DIR } from "../config.ts";
import { changeEmptySection } from "../section-context.ts";
import type { BotRecord } from "../store.ts";
import { approvalCeilingError } from "../user-errors.ts";
import { areaApprovalCeiling, approvalCeiling, ceilingWidens, departmentRenamed, readProfilesState, withDepartmentRenamed } from "./state.ts";

export type BotWriteOptions = { mayLiftCeiling?: boolean; requestedApproval?: ApprovalMode };

export function refuseCeiling(ceiling: ApprovalCeiling): never {
  const { error, ...fields } = approvalCeilingError(ceiling);
  throw Object.assign(new Error(error), fields, { status: 403 });
}

export function botApprovalRefusal(next: Pick<BotRecord, "section" | "profileSource">, before?: BotRecord | null,
  options: BotWriteOptions = {}, areas = readProfilesState(DATA_DIR).areas, nextAreas = areas): ApprovalCeiling | undefined {
  const ceiling = areaApprovalCeiling(nextAreas, next);
  const previous = before && areaApprovalCeiling(areas, before);
  if (previous && !options.mayLiftCeiling && ceilingWidens(previous, ceiling)) return previous;
  if (ceiling && options.requestedApproval && !levelWithin(options.requestedApproval, ceiling)) return ceiling;
  return undefined;
}

export function checkBotApprovalPatch(bot: BotRecord, patch: Partial<BotRecord>, options: BotWriteOptions): void {
  if (!Object.hasOwn(patch, "section") && !Object.hasOwn(patch, "profileSource") && !options.requestedApproval) return;
  const refusal = botApprovalRefusal({ ...bot, ...patch }, bot, options);
  if (refusal) refuseCeiling(refusal);
}

export function enforceBotWriteCeilings(existing: readonly BotRecord[], bots: readonly BotRecord[], options: BotWriteOptions,
  renamed: { from: string; to: string } | undefined, driverKindOf: (id: string) => string | undefined, changed: (id: string) => void) {
  const state = readProfilesState(DATA_DIR);
  const areas = state.areas;
  if (!Object.keys(areas).length) return;
  const nextAreas = renamed ? withDepartmentRenamed(state, renamed.from, renamed.to).areas : areas;
  if (existing !== bots) {
    const byId = new Map(existing.map((bot) => [bot.id, bot]));
    for (const bot of bots) {
      const refusal = botApprovalRefusal(bot, byId.get(bot.id), options, areas, nextAreas);
      if (refusal) refuseCeiling(refusal);
    }
  }
  for (const bot of bots) {
    const ceiling = areaApprovalCeiling(nextAreas, bot);
    if (!ceiling) continue;
    const clamp = (target: Pick<BotRecord, "approvalMode" | "autoApprove">, instanceId: string) => {
      const mode = approvalModeFor({ approvalMode: target.approvalMode, autoApprove: target.autoApprove });
      const limited = withinApprovalCeiling(mode, ceiling);
      if (limited === mode) return;
      const allowed = supportsApprovalMode(driverKindOf(instanceId), limited) ? limited : "ask";
      target.approvalMode = allowed;
      target.autoApprove = allowed === "auto";
      changed(bot.id);
    };
    clamp(bot, bot.modelSelection.instanceId);
    for (const task of bot.tasks ?? []) {
      if (task.approvalMode !== undefined || task.autoApprove !== undefined) clamp(task, task.modelSelection?.instanceId ?? bot.modelSelection.instanceId);
    }
  }
}

export function checkSectionCeiling(name: string, nextName: string | null, options: BotWriteOptions): void {
  if (options.mayLiftCeiling || name.trim().toLowerCase() === nextName?.trim().toLowerCase()) return;
  const ceiling = approvalCeiling(DATA_DIR, { section: name });
  if (ceiling) refuseCeiling(ceiling);
}

export function changeProfileSection(from: string, to: string | null): void {
  changeEmptySection(from, to);
  if (to === null) return;
  try {
    departmentRenamed(DATA_DIR, from, to);
  } catch (error) {
    changeEmptySection(to, from);
    throw error;
  }
}
