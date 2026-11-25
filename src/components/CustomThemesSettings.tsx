import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import type { ThemeExport, ThemeHistoryItem, ThemeList } from "../../shared/theme";
import { t } from "@/lib/i18n";
import { isMacPlatform } from "@/lib/keyboard-shortcuts";
import { relativeTime } from "@/lib/memory";
import { SKINS } from "@/lib/skins";
import { chooseTheme, loadTheme, resetLook, safeLook, subscribeTheme, wornTheme } from "@/lib/theme/runtime";
import { api } from "@/state/api";
import { SettingRow, SettingsEmptyRow, SettingsGroup, SettingsRows } from "./SettingsPrimitives";
import { forgetEdits, hasUnsavedEdits, ThemeEditor } from "./ThemeEditor";

const put = (body: unknown) => ({ method: "PUT", body: JSON.stringify(body) });
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function useWornId(): string | null {
  return useSyncExternalStore(subscribeTheme, () => wornTheme()?.id ?? null, () => null);
}

function download(name: string, data: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

type Act = (work: () => Promise<unknown>) => Promise<void>;

const SHOWN_CHANGES = 6;

function changeText(item: ThemeHistoryItem): string {
  const name = item.name ?? "";
  switch (item.kind) {
    case "made": return t("settings.customThemes.historyMade", { name });
    case "edited": return t("settings.customThemes.historyEdited", { name });
    case "deleted": return t("settings.customThemes.historyDeleted", { name });
    case "wore": return t("settings.customThemes.historyWore", { name });
    case "skin": return t("settings.customThemes.historySkin", { name: SKINS.find((skin) => skin.id === name)?.name ?? name });
    case "default": return t("settings.customThemes.historyDefault");
    case "undid": return t("settings.customThemes.historyUndid");
  }
}

/** The person's latest look changes, from here or a bot, each one a way back to how the app looked right after it. */
function LookHistory({ items, act }: { items: ThemeHistoryItem[]; act: Act }) {
  if (items.length < 2) return null;
  return (
    <SettingsGroup label={t("settings.customThemes.history")} block="theme-history" description={t("settings.customThemes.historyHint")}>
      <SettingsRows>
        {items.slice(0, SHOWN_CHANGES).map((item) => (
          <SettingRow key={item.index} title={changeText(item)} subtitle={relativeTime(Date.parse(item.at))}>
            {item.index === 1
              ? <span className="text-[12px] text-ink-tertiary">{t("settings.customThemes.historyNow")}</span>
              : <button type="button" className="ui-button" onClick={() => void act(async () => {
                await api("/api/themes/history", { method: "POST", body: JSON.stringify({ index: item.index }) });
                await loadTheme();
              })}>{t("settings.customThemes.restore")}</button>}
          </SettingRow>
        ))}
      </SettingsRows>
    </SettingsGroup>
  );
}

/** Settings → Appearance: the person's saved themes, made by them or by a bot. */
export function CustomThemesSettings() {
  const [list, setList] = useState<ThemeList | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [status, setStatus] = useState<ReactNode>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const worn = useWornId();
  const [history, setHistory] = useState<ThemeHistoryItem[]>([]);
  const refresh = useCallback(() => Promise.all([
    api<ThemeList>("/api/themes").then(setList, (error: unknown) => setStatus(errorText(error))),
    api<{ items: ThemeHistoryItem[] }>("/api/themes/history").then((answer) => setHistory(answer.items), () => setHistory([])),
  ]), []);
  useEffect(() => {
    void refresh();
    return subscribeTheme(() => void refresh());
  }, [refresh]);

  const act: Act = async (work) => {
    setStatus(null);
    try {
      await work();
    } catch (error) {
      setStatus(errorText(error));
    }
    await refresh();
  };
  const create = () => act(async () => {
    const id = `theme-${Date.now().toString(36)}`;
    await api(`/api/themes/${id}`, put({ theme: { name: t("settings.customThemes.newName") } }));
    setEditing(id);
  });
  const importFile = (file: File | undefined) => file && act(async () => {
    let data: ThemeExport;
    try {
      data = JSON.parse(await file.text()) as ThemeExport;
    } catch {
      throw new Error(t("settings.customThemes.importFailed"));
    }
    await api("/api/themes/import", { method: "POST", body: JSON.stringify(data) });
  });
  /** Deleted at once; the export taken just before brings it back. */
  const remove = (id: string, name: string) => act(async () => {
    const kept = await api<ThemeExport>(`/api/themes/${id}/export`);
    await api(`/api/themes/${id}`, { method: "DELETE" });
    forgetEdits(id);
    setEditing(null);
    await loadTheme();
    setStatus(<>{t("settings.customThemes.deleted", { name })}{" "}
      <button type="button" className="text-accent-text hover:underline" onClick={() => void act(() => api("/api/themes/import", { method: "POST", body: JSON.stringify(kept) }))}>
        {t("common.undo")}
      </button></>);
  });
  const keys = isMacPlatform() ? "⌘⌥⇧R" : "Ctrl+Alt+Shift+R";

  return (<>
    <SettingsGroup label={t("settings.customThemes.title")} block="custom-themes" description={t("settings.customThemes.description")}
      actions={<>
        <button type="button" className="ui-button" onClick={() => importRef.current?.click()}>{t("settings.customThemes.import")}</button>
        <button type="button" className="ui-button" onClick={() => void create()}>{t("settings.customThemes.new")}</button>
        <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(event) => { void importFile(event.target.files?.[0]); event.target.value = ""; }} />
      </>}
      footnote={status}>
      <SettingsRows>
        {safeLook() && <SettingsEmptyRow>{t("settings.customThemes.safe")}</SettingsEmptyRow>}
        {list && !list.themes.length && <SettingsEmptyRow>{t("settings.customThemes.empty")}</SettingsEmptyRow>}
        {list?.themes.map((theme) => (
          editing === theme.id
            ? <ThemeEditor key={theme.id} id={theme.id} onClose={() => { setEditing(null); void refresh(); }} foot={(file) => <>
              <button type="button" className="ui-button ui-button-sm"
                onClick={() => void act(() => api(`/api/themes/${theme.id}/duplicate`, { method: "POST", body: JSON.stringify({ name: t("settings.customThemes.copyName", { name: file.name }).slice(0, 60) }) }))}>
                {t("settings.customThemes.duplicate")}
              </button>
              <button type="button" className="ui-button ui-button-sm" onClick={() => void act(async () => download(`${theme.id}.mausbot-theme.json`, await api(`/api/themes/${theme.id}/export`)))}>
                {t("settings.customThemes.export")}
              </button>
              <button type="button" className="ui-button ui-button-sm" data-danger="" onClick={() => void remove(theme.id, theme.name)}>{t("common.delete")}</button>
            </>} />
            : (
              <SettingRow key={theme.id} title={theme.name}
                subtitle={hasUnsavedEdits(theme.id) ? t("settings.customThemes.unsaved") : worn === theme.id ? t("settings.customThemes.inUse") : theme.assets.length ? t("settings.customThemes.files", { count: theme.assets.length }) : undefined}>
                <div className="flex items-center gap-1.5">
                  <button type="button" className="ui-button" onClick={() => setEditing(theme.id)}>{t("settings.customThemes.edit")}</button>
                  {worn === theme.id
                    ? <button type="button" className="ui-button" onClick={() => void act(() => chooseTheme(null))}>{t("settings.customThemes.takeOff")}</button>
                    : <button type="button" className="ui-button ui-button-primary" onClick={() => void act(() => chooseTheme(theme.id))}>{t("settings.customThemes.use")}</button>}
                </div>
              </SettingRow>
            )
        ))}
        <SettingRow title={t("settings.customThemes.reset")} subtitle={t("settings.customThemes.resetHint", { keys })}>
          <button type="button" className="ui-button" onClick={() => { resetLook(); void refresh(); }}>{t("settings.customThemes.reset")}</button>
        </SettingRow>
      </SettingsRows>
    </SettingsGroup>
    <LookHistory items={history} act={act} />
  </>);
}
