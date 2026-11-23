// A copy's restrictions go in the request that creates it: a later patch that failed would leave it unrestricted.
import { approvalModeFor, withinApprovalCeiling } from "../../shared/approval-mode";
import { helperModelAllowed } from "../../shared/wire";
import type { Bot } from "@/state/store";
import { currentTeamPeople } from "@/state/team-people";

export type RestrictedSource = Pick<Bot, "visibility" | "toolScope" | "helperModel" | "section" | "approvalMode" | "autoApprove" | "approvalCeiling"> & Partial<Pick<Bot, "modelSelection">>;

export interface RestrictedCopyRequest {
  visibility?: Bot["visibility"];
  section?: Bot["section"];
  modelSelection?: Bot["modelSelection"];
  settings?: { toolScope?: Bot["toolScope"]; helperModel?: false; approvalMode?: Exclude<Bot["approvalMode"], "custom"> };
}

/** A team's User, who gives a copy only what someone who can edit a bot may set: the server refuses the rest. */
const teamUser = () => currentTeamPeople()?.admin === false;

export function restrictedCopyRequest(source: RestrictedSource, user = teamUser()): RestrictedCopyRequest {
  const mode = withinApprovalCeiling(approvalModeFor(source), source.approvalCeiling);
  const permission = source.approvalCeiling || (!user && (source.approvalMode !== undefined || source.autoApprove !== undefined))
    ? { approvalMode: mode === "custom" ? "ask" as const : mode } : {};
  const section = source.section && (!user || source.approvalCeiling) ? { section: source.section } : {};
  if (user) return { ...section, ...(source.approvalCeiling ? { settings: permission } : {}) };
  const settings: NonNullable<RestrictedCopyRequest["settings"]> = {
    ...permission,
    ...(Object.hasOwn(source, "toolScope") ? { toolScope: source.toolScope } : {}),
    ...(helperModelAllowed(source) ? {} : { helperModel: false as const }),
  };
  return {
    ...section,
    ...(mode === "edits" && source.modelSelection ? { modelSelection: source.modelSelection } : {}),
    ...(source.visibility && source.visibility !== "everyone" ? { visibility: source.visibility } : {}),
    ...(Object.keys(settings).length ? { settings } : {}),
  };
}

/** What a copy takes from its source, PATCHed onto the new bot in one request. A copy of a VPS bot keeps its server. */
export function duplicateBotProfile(source: Bot, user = teamUser()) {
  return {
    name: `${source.name} copy`,
    title: source.title,
    description: source.description,
    soul: source.soul,
    notifications: source.notifications,
    modelSelection: source.modelSelection,
    ...(user ? {} : { computer: source.computer, cloudBackend: source.cloudBackend, autoStartVps: source.autoStartVps, vpsAlias: source.vpsAlias }),
    avatarUrl: source.avatarUrl,
    avatarCrop: source.avatarCrop,
    avatarZoom: source.avatarZoom,
    avatarFocusX: source.avatarFocusX,
    avatarFocusY: source.avatarFocusY,
  };
}
