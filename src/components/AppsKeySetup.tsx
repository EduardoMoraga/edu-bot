import { useState, type ReactNode, type Ref } from "react";
import { KeyRound, Loader2, Server, type LucideIcon } from "lucide-react";
import { t } from "@/lib/i18n";
import type { ConfigStatus } from "@/state/store";
import { cleanKey, saveCredential } from "./keys/key-save";

export const COMPOSIO_SIGN_UP_URL = "https://dashboard.composio.dev";
const COMPOSIO_KEY = /^ak_\S+$/;

/** What to do on the Apps page when this app has no Composio project key: two steps, and the key saved right here. */
export function ComposioKeySteps({ fieldRef, onSaved }: { fieldRef?: Ref<HTMLInputElement>; onSaved: (config: ConfigStatus) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    const value = cleanKey(key);
    if (busy || !value) return;
    if (!COMPOSIO_KEY.test(value)) {
      setProblem(t("connectors.setup.wrongKey"));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      onSaved(await saveCredential("composio", value, false));
      setKey("");
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section data-apps-key-steps aria-labelledby="apps-key-steps-title" className="mb-4 rounded-xl bg-control/50 px-4 py-3 text-[13px] leading-5 text-ink-secondary">
      <h3 id="apps-key-steps-title" className="text-[14px] font-medium leading-5 text-ink">{t("connectors.setupNeeded")}</h3>
      <ol className="mt-2 list-decimal space-y-1 ps-5">
        <li>
          {t("connectors.setup.step1")}{" "}
          <a href={COMPOSIO_SIGN_UP_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-accent-text underline underline-offset-2">
            {t("connectors.setup.openComposio")}
          </a>
        </li>
        <li>{t("connectors.setup.pasteHere")}</li>
      </ol>
      <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <input ref={fieldRef} data-apps-key-field type="password" value={key} disabled={busy} autoComplete="off" spellCheck={false} placeholder="ak_…"
          aria-label={t("keys.composio.label")} onChange={(event) => { setKey(event.target.value); setProblem(null); }}
          className="h-9 min-w-0 flex-[1_1_220px] rounded-lg bg-inset px-3 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none focus:ring-1 focus:ring-accent/50" />
        <button type="submit" data-apps-save-key disabled={busy || !key.trim()} className="ui-button ui-button-md ui-button-pill ui-button-primary">
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <KeyRound size={16} aria-hidden="true" />}
          {t("common.save")}
        </button>
      </form>
      {problem && <p role="alert" className="mt-2 text-[12px] text-danger">{problem}</p>}
    </section>
  );
}

/** The first thing on the Apps page while no Composio key is saved: the tools that connect with one click or one paste. */
export function AppsStartHere({ children }: { children: ReactNode }) {
  return (
    <section data-apps-start aria-labelledby="apps-start-title" className="@container mb-6">
      <h3 id="apps-start-title" className="px-2 text-[14px] font-semibold leading-5 text-ink">{t("apps.start.title")}</h3>
      <p className="mb-1.5 px-2 text-[13px] leading-5 text-ink-secondary">{t("apps.start.help")}</p>
      <div className="grid grid-cols-1 items-start gap-x-6 gap-y-1 @xl:grid-cols-2">{children}</div>
    </section>
  );
}

/** A Start-here tile that is not a hosted app: one glyph, one name, one sentence saying what is missing, one button. */
export function StartTile({ id, glyph: Glyph, label, line, action, onAction }: {
  id: string; glyph: LucideIcon; label: string; line: string; action: string; onAction: () => void;
}) {
  return (
    <div data-start-tile={id} className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-raised/40">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-raised text-ink-secondary"><Glyph size={19} aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold leading-5 text-ink">{label}</div>
        <p className="text-[13px] leading-[18px] text-ink-secondary">{line}</p>
      </div>
      <button type="button" onClick={onAction} aria-label={`${action}: ${label}`}
        className="inline-flex h-7 min-w-[64px] shrink-0 items-center justify-center rounded-full bg-control/80 px-3 text-[13px] font-medium leading-5 text-ink hover:bg-raised-hover">
        {action}
      </button>
    </div>
  );
}

/** The Connected view with nothing in it and no Composio key: both ways to add something. */
export function ConnectedEmptyWithoutKey({ onPasteKey, onAddMcp }: { onPasteKey: () => void; onAddMcp: () => void }) {
  return (
    <div data-apps-connected-empty="no-key" className="flex min-h-40 flex-col items-center justify-center text-center">
      <div className="text-[14px] font-medium text-ink">{t("connectors.empty.noneTitle")}</div>
      <div className="mt-1 text-[13px] text-ink-secondary">{t("connectors.empty.noKeyDesc")}</div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={onPasteKey} className="ui-button ui-button-md ui-button-pill ui-button-primary">
          <KeyRound size={16} aria-hidden="true" />
          {t("connectors.setup.pasteKey")}
        </button>
        <button type="button" onClick={onAddMcp} className="ui-button ui-button-md ui-button-pill">
          <Server size={16} aria-hidden="true" />
          {t("connectors.empty.addMcp")}
        </button>
      </div>
    </div>
  );
}
