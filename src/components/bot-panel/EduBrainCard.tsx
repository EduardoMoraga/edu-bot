import { useCallback, useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { decideEduProposal, fetchEduBrain } from "@/lib/edu-brain";
import { eduProposalFacts } from "@/lib/edu-proposal-words";
import type { Bot } from "@/state/store";
import type { EduBrainView, EduProposal } from "../../../shared/edu-brain";
import { buttonCls, Card, ColRow, ItemRow, NoteRow } from "./rows";

/** What the Edu brain row says, and what to do when Edu can't serve this bot. */
export function eduStatusWords(view: Pick<EduBrainView, "state" | "mode" | "version" | "reason">): { value: string; hint?: string; warn?: boolean } {
  if (view.mode === "off") return { value: t("eduBrain.state.botOff") };
  switch (view.state) {
    case "ready": return { value: view.version ? t("eduBrain.state.readyVersion", { version: view.version }) : t("eduBrain.state.ready") };
    case "off": return { value: t("eduBrain.state.appOff"), hint: t("eduBrain.state.appOffHint") };
    case "missing": return { value: t("eduBrain.state.missing"), hint: t("eduBrain.state.missingHint"), warn: true };
    case "old": return { value: t("eduBrain.state.old", { version: view.version ?? "?" }), hint: t("eduBrain.state.oldHint"), warn: true };
    case "broken": return { value: t("eduBrain.state.broken"), hint: view.reason ?? t("eduBrain.state.brokenHint"), warn: true };
  }
}

function PathValue({ path }: { path: string }) {
  return <span dir="ltr" title={path} className="block truncate font-mono text-[12px] text-ink-secondary">{path}</span>;
}

/** Bot settings, Memory: this bot's Edu brain and the canonical notes waiting for the person, wherever they were
 * proposed. */
export function EduBrainCard({ bot }: { bot: Pick<Bot, "id" | "name" | "busy"> }) {
  const [view, setView] = useState<EduBrainView | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setView(await fetchEduBrain(bot.id));
      setFailed(null);
    } catch (error) {
      setFailed(error instanceof Error && error.message ? error.message : t("eduBrain.loadFailed"));
    }
  }, [bot.id]);
  useEffect(() => { void load(); }, [load, bot.busy]);

  const decide = async (proposal: EduProposal, action: "approve" | "reject") => {
    if (busy) return;
    setBusy(`${action}:${proposal.id}`);
    try {
      await decideEduProposal(bot.id, proposal.id, action);
      setFailed(null);
    } catch (error) {
      setFailed(error instanceof Error && error.message ? error.message : t("eduBrain.decideFailed"));
    } finally {
      setBusy(null);
      await load();
    }
  };

  const status = view ? eduStatusWords(view) : null;
  const ready = view?.state === "ready" && view.mode !== "off";
  return (
    <>
      <Card label={t("eduBrain.section")} anchor="edu-brain">
        {!view ? (
          <NoteRow tone={failed ? "warn" : undefined}>{failed ?? t("common.checking")}</NoteRow>
        ) : (
          <>
            <ItemRow data-panel-row="edu-status" title={t("eduBrain.status")} hint={status?.hint && <span className={status.warn ? "text-warning" : undefined}>{status.hint}</span>}>
              <span className="shrink-0 text-[13px] text-ink-secondary">{status?.value}</span>
            </ItemRow>
            {ready && view.brain && <ItemRow data-panel-row="edu-folder" title={t("eduBrain.folder")} hint={<PathValue path={view.brain} />} />}
            {ready && view.home && <ItemRow data-panel-row="edu-home" title={t("eduBrain.global")} hint={<PathValue path={view.home} />} />}
          </>
        )}
      </Card>
      {view && ready && (
        <Card label={t("eduBrain.proposals")} anchor="edu-proposals">
          {view.crewWorker && <NoteRow tone="warn">{t("eduBrain.crewWorker")}</NoteRow>}
          {!view.crewWorker && !view.mayApprove && view.proposals.length > 0 && <NoteRow>{t("eduBrain.approveElsewhere")}</NoteRow>}
          {view.listError && <NoteRow tone="warn">{t("eduBrain.listFailed", { reason: view.listError })}</NoteRow>}
          {!view.listError && view.proposals.length === 0 && <NoteRow>{t("eduBrain.noProposals")}</NoteRow>}
          {view.proposals.map((proposal) => (
            <ColRow key={`${proposal.global ? "g" : "b"}:${proposal.id}`} data-panel-row="edu-proposal">
              <div className="min-w-0">
                <div dir="auto" className="break-words text-[14px] font-medium text-ink">{proposal.title}</div>
                <div className="mt-px text-[13px] leading-[1.35] text-ink-secondary">{eduProposalFacts(proposal)}</div>
                {proposal.body && <p dir="auto" className="mt-1.5 line-clamp-4 whitespace-pre-wrap break-words text-[13px] leading-[1.45] text-ink">{proposal.body}</p>}
                {proposal.global && <p data-edu-global className="mt-1.5 text-[13px] leading-[1.35] text-warning">{t("server.edu.globalWarning")}</p>}
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" data-edu-action="reject" className={buttonCls} disabled={busy !== null || view.crewWorker}
                  onClick={() => void decide(proposal, "reject")}>
                  {busy === `reject:${proposal.id}` ? t("eduBrain.action.rejecting") : t("server.edu.reject")}
                </button>
                <button type="button" data-edu-action="approve" className={buttonCls} disabled={busy !== null || !view.mayApprove}
                  onClick={() => void decide(proposal, "approve")}>
                  {busy === `approve:${proposal.id}` ? t("eduBrain.action.approving") : t("server.edu.approve")}
                </button>
              </div>
            </ColRow>
          ))}
          {failed && <NoteRow tone="warn">{failed}</NoteRow>}
        </Card>
      )}
    </>
  );
}
