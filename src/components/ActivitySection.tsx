import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ChevronRight, Download, Loader2, RefreshCw } from "lucide-react";

import { api } from "@/state/store";
import { useStoreSelector } from "@/state/store-select";
import { routineLineText } from "@/lib/activity-text";
import { cn } from "@/lib/cn";
import { intlLocale, t } from "@/lib/i18n";
import { ACTIVITY_WHATS, activityQuery, describeEntry, formatValue, whoLabel, type ActivityEntry, type ActivityFilters, type ActivityWhat } from "@/lib/activity";
import type { LocaleKey } from "@/locales";
import { Select } from "./Select";
import { Card, SETTINGS_INLINE_INPUT, SettingRow, SettingsEmptyRow, SettingsFormFoot, SettingsGroup, SettingsLook, SettingsRows } from "./SettingsPrimitives";

const inputClass = "rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none [color-scheme:dark]";

export function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const [open, setOpen] = useState(false);
  const detail = entry.type === "admin" && (entry.changed?.length || entry.before || entry.after);
  return (
    <li className="border-b border-hairline/20 py-2 text-[13px]" data-activity-entry={entry.type}>
      <div className="grid grid-cols-[auto_1fr] items-start gap-x-3">
        <time className="whitespace-nowrap tabular-nums text-ink-secondary" dateTime={entry.at}>{new Date(entry.at).toLocaleString(intlLocale())}</time>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-ink">{whoLabel(entry.who)}</span>
            <span className="min-w-0 break-words text-ink">{describeEntry(entry)}</span>
          </div>
          {entry.type === "approval" && entry.summary && <div className="mt-0.5 truncate text-[12px] text-ink-secondary">{routineLineText(entry.summaryCode, entry.summary, entry.summaryParams)}</div>}
          {detail && (
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="cursor-pointer mt-0.5 flex items-center gap-1 text-[12px] text-ink-secondary hover:text-ink">
              <ChevronRight size={12} className={cn("transition-transform", open && "rotate-90")} />
              {t("activity.changed", { paths: (entry.changed ?? []).join(", ") || "—" })}
            </button>
          )}
          {detail && open && entry.type === "admin" && (
            <dl className="mt-1 grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-0.5 rounded-lg bg-inset p-2 text-[12px]">
              <dt />
              <dd className="text-ink-secondary">{t("activity.before")}</dd>
              <dd className="text-ink-secondary">{t("activity.after")}</dd>
              {(entry.changed ?? Object.keys({ ...entry.before, ...entry.after })).map((path) => (
                <div key={path} className="contents">
                  <dt className="font-mono text-ink-secondary">{path}</dt>
                  <dd className="min-w-0 break-all font-mono text-ink">{formatValue(entry.before?.[path])}</dd>
                  <dd className="min-w-0 break-all font-mono text-ink">{formatValue(entry.after?.[path])}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </li>
  );
}

export function ActivitySection({ initialBot }: { initialBot?: string }) {
  const bots = useStoreSelector((state) => state.bots);
  const areas = [...new Set(bots.flatMap((bot) => bot.section ? [bot.section] : []))].sort((a, b) => a.localeCompare(b, intlLocale()));
  const [filters, setFilters] = useState<ActivityFilters>({ who: "", what: "all", from: "", to: "", bot: initialBot });
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [days, setDays] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const query = activityQuery(filters);
  const settings = useContext(SettingsLook);

  const request = useRef(0);
  const load = useCallback(async () => {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const body = await api(`/api/admin-activity${query}`) as { entries: ActivityEntry[]; total: number; retentionDays: number };
      if (request.current !== id) return;
      setEntries(body.entries);
      setTotal(body.total);
      setDays(body.retentionDays);
    } catch (cause) {
      if (request.current === id) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request.current === id) setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => {
      request.current += 1;
      window.clearTimeout(timer);
    };
  }, [load]);

  const set = (patch: Partial<ActivityFilters>) => setFilters((current) => ({ ...current, ...patch }));
  const scopeFilters = [
    { field: "bot", label: t("activity.bot"), any: t("activity.allBots"), options: bots.map((bot) => ({ value: bot.id, name: bot.name })) },
    { field: "area", label: t("activity.area"), any: t("activity.allAreas"), options: areas.map((area) => ({ value: area, name: area })) },
  ] as const;
  const selectScope = (filter: typeof scopeFilters[number]) => (
    <Select value={filters[filter.field] ?? ""} onChange={(event) => set({ [filter.field]: event.target.value })} aria-label={filter.label}>
      <option value="">{filter.any}</option>
      {filter.options.map(({ value, name }) => <option key={value} value={value}>{name}</option>)}
    </Select>
  );
  if (settings) {
    // In Settings: one section (its description is the foot line), Export CSV as its one action, the filters as rows
    // with their controls on one edge, and the entries in a card of their own.
    return (
      <SettingsGroup label={t("settings.section.activity")} block="activity" footnote={t("activity.subtitle", { days: String(days ?? 180) })}
        actions={<a href={`/api/admin-activity.csv${query}`} download className="ui-button ui-button-md rounded-full">{t("activity.export")}</a>}>
        <SettingsRows>
          <SettingRow title={t("activity.who")}>
            <input value={filters.who} onChange={(e) => set({ who: e.target.value })} placeholder={t("activity.whoPlaceholder")} aria-label={t("activity.who")}
              className={cn(SETTINGS_INLINE_INPUT, "w-[200px] text-left")} />
          </SettingRow>
          <SettingRow title={t("activity.what")}>
            <Select value={filters.what} onChange={(e) => set({ what: e.target.value as ActivityWhat })} aria-label={t("activity.what")}>
              {ACTIVITY_WHATS.map((what) => <option key={what} value={what}>{t(`activity.what.${what}` as LocaleKey)}</option>)}
            </Select>
          </SettingRow>
          {scopeFilters.map((filter) => <SettingRow key={filter.field} title={filter.label}>{selectScope(filter)}</SettingRow>)}
          <SettingRow title={t("activity.dates")}>
            <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} aria-label={t("activity.from")}
              className={cn(SETTINGS_INLINE_INPUT, "w-[140px] text-left")} />
            <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} aria-label={t("activity.to")}
              className={cn(SETTINGS_INLINE_INPUT, "w-[140px] text-left")} />
          </SettingRow>
          <SettingsFormFoot status={error ? <span role="alert" className="text-danger">{t("activity.error", { message: error })}</span>
            : total > entries.length ? t("activity.more", { shown: String(entries.length), total: String(total) }) : undefined}>
            <button type="button" onClick={() => void load()} disabled={loading} className="settings-quiet cursor-pointer">{loading ? t("common.checking") : t("activity.refresh")}</button>
          </SettingsFormFoot>
        </SettingsRows>
        <SettingsRows>
          {!error && entries.length === 0 && !loading && <SettingsEmptyRow>{t("activity.empty")}</SettingsEmptyRow>}
          {entries.length > 0 && <ul className="flex flex-col px-4 py-1">{entries.map((entry, index) => <ActivityRow key={`${entry.at}-${index}`} entry={entry} />)}</ul>}
        </SettingsRows>
      </SettingsGroup>
    );
  }
  return (
    <Card title={t("activity.title")} subtitle={t("activity.subtitle", { days: String(days ?? 180) })}>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
          {t("activity.who")}
          <input value={filters.who} onChange={(e) => set({ who: e.target.value })} placeholder={t("activity.whoPlaceholder")} className={cn(inputClass, "w-44")} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
          {t("activity.what")}
          <Select value={filters.what} onChange={(e) => set({ what: e.target.value as ActivityWhat })}>
            {ACTIVITY_WHATS.map((what) => <option key={what} value={what}>{t(`activity.what.${what}` as LocaleKey)}</option>)}
          </Select>
        </label>
        {scopeFilters.map((filter) => (
          <label key={filter.field} className="flex flex-col gap-1 text-[12px] text-ink-secondary">{filter.label}{selectScope(filter)}</label>
        ))}
        <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
          {t("activity.from")}
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set({ from: e.target.value })} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
          {t("activity.to")}
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set({ to: e.target.value })} className={inputClass} />
        </label>
        <button type="button" onClick={() => void load()} disabled={loading} aria-label={t("activity.refresh")} title={t("activity.refresh")} className="cursor-pointer rounded-md p-2 text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
        <a href={`/api/admin-activity.csv${query}`} download className="ui-button hover:bg-raised-hover">
          <Download size={13} aria-hidden="true" />{t("activity.export")}
        </a>
      </div>
      {error && <p role="alert" className="mt-3 text-[13px] text-danger">{t("activity.error", { message: error })}</p>}
      {!error && entries.length === 0 && !loading && <p className="mt-4 text-[13px] text-ink-secondary">{t("activity.empty")}</p>}
      {entries.length > 0 && (
        <ul className="mt-3 flex flex-col">
          {entries.map((entry, index) => <ActivityRow key={`${entry.at}-${index}`} entry={entry} />)}
        </ul>
      )}
      {total > entries.length && <p className="mt-3 text-[12px] text-ink-secondary">{t("activity.more", { shown: String(entries.length), total: String(total) })}</p>}
    </Card>
  );
}
