import { Bot as BotIcon } from "lucide-react";
import { api, type Bot } from "@/state/store";
import { useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { useAdvancedMode } from "@/lib/interface-mode";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { suggestComposerDraft } from "@/lib/drafts";
import { t } from "@/lib/i18n";
import { EduMascot } from "./EduMascot";
import { RenameTitle } from "./RenameTitle";

const SUGGESTIONS = ["chat.empty.suggest.summarize", "chat.empty.suggest.email", "chat.empty.suggest.plan", "chat.empty.suggest.explain"] as const;

function focusComposer(): void {
  requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-tour="composer"] textarea')?.focus());
}

/** A chat with no messages yet. A suggestion fills the composer and is never sent; `canWrite` false leaves them out. */
export function EmptyChat({ bot, canWrite = true }: { bot: Bot; canWrite?: boolean }) {
  const dispatch = useStoreDispatch();
  const advanced = useAdvancedMode();
  const onTeam = useStoreSelector((state) => Boolean(state.config?.team));
  const mayAddBots = useOwnerOrAdmin() !== false || onTeam;
  return (
    <div data-chat-empty="" className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center">
      <EduMascot mood="happy" size={96} animated={false} />
      <div className="flex flex-col items-center gap-2">
        {!advanced ? <div className="text-[17px] font-semibold text-ink">{bot.name}</div> : <RenameTitle
          value={bot.name}
          onCommit={(name) => {
            if (window.ogb?.remoteClient?.active) {
              void api(`/api/bots/${bot.id}/profile`, { method: "PATCH", body: JSON.stringify({ name }) })
                .then(({ bot: updated }) => dispatch({ type: "botPatched", bot: updated }))
                .catch((cause) => dispatch({ type: "error", message: cause instanceof Error ? cause.message : String(cause) }));
            } else {
              dispatch({ type: "updateBot", botId: bot.id, patch: { name } });
            }
          }}
          className="text-[17px] font-semibold text-ink"
          inputClassName="rounded bg-inset px-1.5 py-0.5 text-center text-[17px] font-semibold"
        />}
        <div className="max-w-[360px] text-[13px] leading-[18px] text-ink-secondary">
          {bot.description || t("chat.emptyPrompt")}
        </div>
      </div>
      {canWrite && (
        <div role="group" aria-label={t("chat.empty.suggestions")} className="flex max-w-[520px] flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((key) => (
            <button key={key} type="button" data-chat-suggestion="" className="ui-pill"
              onClick={() => { suggestComposerDraft(`bot:${bot.id}:${bot.threadId}`, t(key)); focusComposer(); }}>
              <span className="truncate">{t(key)}</span>
            </button>
          ))}
        </div>
      )}
      {mayAddBots && (
        <button type="button" data-chat-new-bot="" className="ui-button ui-button-md" onClick={() => dispatch({ type: "newBot" })}>
          <BotIcon size={16} aria-hidden="true" />
          {t("sidebar.newBotSimple")}
        </button>
      )}
    </div>
  );
}
