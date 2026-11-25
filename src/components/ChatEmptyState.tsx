import { Bot as BotIcon } from "lucide-react";
import { api, type Bot } from "@/state/store";
import { useStoreDispatch, useStoreSelector } from "@/state/store-select";
import { useAdvancedMode } from "@/lib/interface-mode";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { suggestComposerDraft } from "@/lib/drafts";
import { t } from "@/lib/i18n";
import { RenameTitle } from "./RenameTitle";

const SUGGESTIONS = ["chat.empty.suggest.summarize", "chat.empty.suggest.email", "chat.empty.suggest.plan", "chat.empty.suggest.explain"] as const;

export function EmptyChatArt() {
  return (
    <svg data-empty-chat-art="" aria-hidden="true" width="144" height="108" viewBox="0 0 160 120" fill="none">
      <path d="M82 14h50a18 18 0 0 1 18 18v22a18 18 0 0 1-18 18h-2l6 13-19-13H82a18 18 0 0 1-18-18V32a18 18 0 0 1 18-18Z" fill="var(--color-raised-hover)" />
      <rect x="82" y="33" width="50" height="6" rx="3" fill="var(--color-ink)" opacity="0.14" />
      <rect x="82" y="47" width="32" height="6" rx="3" fill="var(--color-ink)" opacity="0.14" />
      <path d="M32 40h56a20 20 0 0 1 20 20v24a20 20 0 0 1-20 20H48l-22 13 6-15a20 20 0 0 1-20-18V60a20 20 0 0 1 20-20Z" fill="var(--color-accent)" stroke="var(--color-app)" strokeWidth="4" strokeLinejoin="round" />
      <circle cx="46" cy="66" r="4" fill="var(--color-accent-ink)" />
      <circle cx="74" cy="66" r="4" fill="var(--color-accent-ink)" />
      <path d="M48 80c7 7 17 7 24 0" stroke="var(--color-accent-ink)" strokeWidth="4" strokeLinecap="round" />
      <path d="M30 8l3 8 8 3-8 3-3 8-3-8-8-3 8-3 3-8Z" fill="var(--color-accent-text)" />
      <circle cx="52" cy="22" r="3" fill="var(--color-accent-text)" opacity="0.5" />
    </svg>
  );
}

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
      <EmptyChatArt />
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
