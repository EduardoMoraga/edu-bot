import { useEffect, useState, type ReactNode } from "react";

import { themeCssProblem, THEME_LIMITS, type ThemeFile } from "../../shared/theme";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { chooseTheme, loadTheme, previewTheme, wornTheme } from "@/lib/theme/runtime";
import { api } from "@/state/api";
import { SETTINGS_INPUT, SettingsEmptyRow, SettingsField, SettingsFormFoot } from "./SettingsPrimitives";

type Draft = { saved: ThemeFile; draft: ThemeFile };

/** Edits not saved yet, by theme id: closing the editor, opening another theme or leaving Settings keeps them; only
 * Cancel, Save and Delete let them go. */
const drafts = new Map<string, Draft>();

const same = (a: ThemeFile, b: ThemeFile) => JSON.stringify(a) === JSON.stringify(b);

export function hasUnsavedEdits(id: string): boolean {
  const kept = drafts.get(id);
  return Boolean(kept && !same(kept.saved, kept.draft));
}

export function forgetEdits(id: string): void {
  drafts.delete(id);
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
const HEX = /^#[0-9a-f]{6}$/i;
const COLOR_KEYS = ["canvas", "accent"] as const;
type ColorKey = (typeof COLOR_KEYS)[number];
const COLOR_ROLE: Record<ColorKey, string> = { canvas: "--color-app", accent: "--color-accent" };

/** Where the colour picker starts for a colour the theme leaves to its skin: the colour on screen now. */
function shownColor(key: ColorKey): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(COLOR_ROLE[key]).trim();
  return HEX.test(value) ? value : key === "canvas" ? "#121212" : "#1084fe";
}

function ColorField({ role, name, value, onChange, onClear }: { role: ColorKey; name: string; value: string | undefined; onChange: (value: string) => void; onClear: () => void }) {
  return (
    <div className="flex items-center gap-2 text-[13px] text-ink">
      <label className="relative flex size-7 shrink-0 cursor-pointer rounded-full ring-1 ring-hairline has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus"
        style={value ? { background: value } : undefined}>
        <input type="color" aria-label={name} className="absolute inset-0 size-full cursor-pointer opacity-0"
          value={value ?? shownColor(role)} onChange={(event) => onChange(event.target.value)} />
        {!value && <span aria-hidden="true" className="m-1 flex-1 rounded-full border border-dashed border-ink-tertiary" />}
      </label>
      <span>{name}</span>
      <span className={cn("text-[12px] text-ink-tertiary", value && "font-mono")}>{value ?? t("settings.customThemes.notSet")}</span>
      {value && <button type="button" className="text-[12px] text-accent-text hover:underline" onClick={onClear}>{t("settings.customThemes.clear")}</button>}
    </div>
  );
}

/** One theme opened: its name, two colours and its CSS, painted on the window while it is edited. */
export function ThemeEditor({ id, onClose, foot }: { id: string; onClose: () => void; foot: (file: ThemeFile) => ReactNode }) {
  const [kept, setKept] = useState<Draft | null>(drafts.get(id) ?? null);
  const [status, setStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (drafts.has(id)) return;
    let open = true;
    void api<{ theme: ThemeFile }>(`/api/themes/${id}`).then((answer) => {
      if (!open) return;
      const fresh = { saved: answer.theme, draft: answer.theme };
      drafts.set(id, fresh);
      setKept(fresh);
    }, (error: unknown) => { if (open) setStatus(errorText(error)); });
    return () => { open = false; };
  }, [id]);
  const draft = kept?.draft;
  const problem = draft?.css ? themeCssProblem(draft.css) : null;
  useEffect(() => {
    if (draft) previewTheme({ id, theme: problem ? { ...draft, css: undefined } : draft });
  }, [id, draft, problem]);
  useEffect(() => () => {
    previewTheme(null);
    if (!hasUnsavedEdits(id)) drafts.delete(id);
  }, [id]);
  if (!kept || !draft) return <SettingsEmptyRow>{status ?? t("settings.customThemes.loading")}</SettingsEmptyRow>;

  const edit = (next: ThemeFile) => {
    const changed = { saved: kept.saved, draft: next };
    drafts.set(id, changed);
    setKept(changed);
    setStatus(null);
  };
  const inUse = wornTheme()?.id === id;
  const save = async () => {
    setSaving(true);
    try {
      const file = { ...draft, name: draft.name.trim(), css: draft.css || undefined };
      await api(`/api/themes/${id}`, { method: "PUT", body: JSON.stringify({ theme: file }) });
      drafts.set(id, { saved: file, draft: file });
      setKept({ saved: file, draft: file });
      if (inUse) await loadTheme();
      const used = inUse || (await chooseTheme(id));
      setStatus(t(used ? "settings.customThemes.savedInUse" : "settings.customThemes.saved"));
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setSaving(false);
    }
  };
  const cancel = () => {
    drafts.delete(id);
    onClose();
  };
  return (
    <div data-settings-block="theme-editor" className="flex flex-col gap-3 px-4 py-3">
      <SettingsField label={t("settings.customThemes.name")}>
        <input className={SETTINGS_INPUT} value={draft.name} maxLength={60} onChange={(event) => edit({ ...draft, name: event.target.value })} />
      </SettingsField>
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        {COLOR_KEYS.map((key) => (
          <ColorField key={key} role={key} name={t(key === "canvas" ? "settings.customThemes.canvas" : "settings.customThemes.accent")} value={draft[key]}
            onChange={(value) => edit({ ...draft, [key]: value })} onClear={() => edit({ ...draft, [key]: undefined })} />
        ))}
      </div>
      <SettingsField label={t("settings.customThemes.css")} hint={problem ?? t("settings.customThemes.cssHint")}>
        <textarea className={`${SETTINGS_INPUT} h-64 resize-y py-2 font-mono text-[12px]`} spellCheck={false} maxLength={THEME_LIMITS.cssChars}
          aria-label={t("settings.customThemes.css")} value={draft.css ?? ""} onChange={(event) => edit({ ...draft, css: event.target.value })} />
      </SettingsField>
      <SettingsFormFoot status={status}>
        <div className="me-auto flex shrink-0 gap-1.5">{foot(kept.saved)}</div>
        <button type="button" className="ui-button shrink-0" onClick={cancel}>{t("common.cancel")}</button>
        <button type="button" className="ui-button ui-button-primary shrink-0" disabled={saving || Boolean(problem) || !draft.name.trim()} onClick={() => void save()}>
          {t(inUse ? "common.save" : "settings.customThemes.saveAndUse")}
        </button>
      </SettingsFormFoot>
    </div>
  );
}
