import { api } from "@/state/store";
import type { EduBrainView } from "../../shared/edu-brain";

export function fetchEduBrain(botId: string): Promise<EduBrainView> {
  return api<EduBrainView>(`/api/bots/${encodeURIComponent(botId)}/edu`);
}

export function decideEduProposal(botId: string, id: string, action: "approve" | "reject"): Promise<{ ok: true; outcome: string }> {
  return api(`/api/bots/${encodeURIComponent(botId)}/edu/proposals/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ action }) });
}
