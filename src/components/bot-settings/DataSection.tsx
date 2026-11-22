import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { api } from "@/state/api";
import type { DataGrantMap } from "../../../shared/data-connections";
import type { Bot } from "@/state/store";
import { useStoreDispatch } from "@/state/store-select";

interface Row { allow: boolean; tables: string; schemas: string; write: "never" | "ask" }

const split = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

export function DataSection({ bot }: { bot: Bot }) {
  const dispatch = useStoreDispatch();
  const [names, setNames] = useState<string[] | null>(null);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    api<{ connections: Array<{ name: string }> }>("/api/data-connections")
      .then((body) => {
        if (cancelled) return;
        const grants = bot.dataConnections ?? {};
        const list = [...new Set([...body.connections.map((item) => item.name), ...Object.keys(grants)])].sort();
        const next: Record<string, Row> = {};
        for (const name of list) {
          const grant = grants[name];
          next[name] = {
            allow: Boolean(grant),
            tables: grant?.tables?.join(", ") ?? "",
            schemas: grant?.schemas?.join(", ") ?? "",
            write: grant?.write === "ask" ? "ask" : "never",
          };
        }
        setNames(list);
        setRows(next);
      })
      .catch(() => { if (!cancelled) setNames([]); });
    return () => { cancelled = true; };
  }, [bot.id, bot.dataConnections]);

  const save = () => {
    const grants: DataGrantMap = {};
    for (const name of names ?? []) {
      const row = rows[name];
      if (!row?.allow) continue;
      const tables = split(row.tables);
      const schemas = split(row.schemas);
      grants[name] = { ...(schemas.length ? { schemas } : {}), ...(tables.length ? { tables } : {}), write: row.write };
    }
    dispatch({ type: "updateBot", botId: bot.id, patch: { dataConnections: Object.keys(grants).length ? grants : null } });
    setNote(t("botSettings.data.saved"));
  };

  const setRow = (name: string, patch: Partial<Row>) => setRows((current) => ({ ...current, [name]: { ...current[name]!, ...patch } }));

  return (
    <div className="rounded-xl bg-card p-4">
      <p className="text-[13px] leading-[18px] text-ink-secondary">{t("botSettings.data.help")}</p>
      {names && names.length === 0 && <p className="mt-3 text-[13px] text-ink-secondary">{t("botSettings.data.none")}</p>}
      <div className="mt-3 flex flex-col gap-3">
        {(names ?? []).map((name) => {
          const row = rows[name];
          if (!row) return null;
          return (
            <div key={name} className="flex flex-col gap-2 border-t border-hairline pt-3">
              <label className="flex items-center gap-2 text-[14px] text-ink">
                <input type="checkbox" checked={row.allow} onChange={(event) => setRow(name, { allow: event.target.checked })} />
                {t("botSettings.data.allow")} {name}
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
                {t("botSettings.data.tables")}
                <input className="h-8 rounded-lg bg-app px-2 text-[13px] text-ink" disabled={!row.allow} value={row.tables} onChange={(event) => setRow(name, { tables: event.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
                {t("botSettings.data.schemas")}
                <input className="h-8 rounded-lg bg-app px-2 text-[13px] text-ink" disabled={!row.allow} value={row.schemas} onChange={(event) => setRow(name, { schemas: event.target.value })} />
              </label>
              <label className="flex items-center justify-between gap-3 text-[13px] text-ink">
                {t("botSettings.data.write")}
                <select className="h-8 rounded-lg bg-app px-2" disabled={!row.allow} value={row.write} aria-label={t("botSettings.data.write")} onChange={(event) => setRow(name, { write: event.target.value as Row["write"] })}>
                  <option value="never">{t("botSettings.data.writeNever")}</option>
                  <option value="ask">{t("botSettings.data.writeAsk")}</option>
                </select>
              </label>
            </div>
          );
        })}
      </div>
      {names && names.length > 0 && (
        <div className="mt-3 flex items-center justify-end gap-3">
          {note && <span className="mr-auto text-[12px] text-ink-secondary">{note}</span>}
          <button type="button" className="ui-button ui-button-primary" onClick={save}>{t("botSettings.data.save")}</button>
        </div>
      )}
    </div>
  );
}
