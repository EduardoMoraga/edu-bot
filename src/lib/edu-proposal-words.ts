import { t } from "@/lib/i18n";
import type { EduProposal } from "../../shared/edu-brain";

export function eduProposalTitle(proposal: Pick<EduProposal, "global">, botName: string): string {
  return proposal.global ? t("server.edu.titleGlobal") : t("server.edu.titleOwn", { name: botName });
}

/** Edu's own kind, band and reason stay in Edu's words. */
export function eduProposalFacts(proposal: Pick<EduProposal, "kind" | "band" | "why">): string {
  return [proposal.kind, proposal.band, proposal.why].filter(Boolean).join(" · ");
}

export function eduProposalDetail(proposal: EduProposal): string {
  const lines = [proposal.title, eduProposalFacts(proposal)];
  if (proposal.body) lines.push("", proposal.body);
  lines.push("", t(proposal.global ? "server.edu.globalBrain" : "server.edu.brain", { path: proposal.brain }));
  if (proposal.global) lines.push(t("server.edu.globalWarning"));
  return lines.join("\n");
}

/** What a settled Edu proposal card says. */
export function eduProposalOutcome(answered: string | undefined): string | undefined {
  if (!answered) return undefined;
  return t(answered === "allow" ? "eduBrain.status.approved" : answered === "deny" ? "eduBrain.status.rejected" : "eduBrain.status.gone");
}
