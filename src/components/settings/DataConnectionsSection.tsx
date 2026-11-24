// The connection string is written once into the Vault. The list that comes back names the vault, never the string.
import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { api } from "@/state/api";
import { Select } from "../Select";
import { SETTINGS_INPUT, SettingsEmptyRow, SettingsField, SettingsFormFoot, SettingsGroup, SettingsRows } from "../SettingsPrimitives";

type ConnectionType = "postgres" | "sqlite" | "duckdb";
interface PublicConnection { name: string; type: ConnectionType; readOnly: true; where: string }
interface Listed { connections: PublicConnection[]; folders: string[] }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : t("settings.data.connectionFailed"));

export function DataConnectionsSection() {
  const [listed, setListed] = useState<Listed | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<ConnectionType>("sqlite");
  const [secret, setSecret] = useState("");
  const [path, setPath] = useState("");
  const [folder, setFolder] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api<Listed>("/api/data-connections").then(setListed).catch((error: unknown) => setStatus(messageOf(error)));
  useEffect(() => { void load(); }, []);

  const add = async () => {
    setBusy(true);
    setStatus("");
    try {
      await api("/api/data-connections", {
        method: "POST",
        body: JSON.stringify(type === "postgres" ? { name, type, dsn: secret } : { name, type, path }),
      });
      setSecret("");
      setName("");
      setPath("");
      await load();
    } catch (error) {
      setStatus(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const test = async (connection: string) => {
    setStatus("");
    try {
      await api(`/api/data-connections/${encodeURIComponent(connection)}/test`, { method: "POST", body: "{}" });
      setStatus(t("settings.data.connectionTested"));
    } catch (error) {
      setStatus(messageOf(error));
    }
  };

  const remove = async (connection: string) => {
    setStatus("");
    try {
      await api(`/api/data-connections/${encodeURIComponent(connection)}`, { method: "DELETE" });
      await load();
    } catch (error) {
      setStatus(messageOf(error));
    }
  };

  const removeFolder = async (path: string) => {
    setStatus("");
    try {
      await api("/api/data-connections/folders", { method: "DELETE", body: JSON.stringify({ path }) });
      await load();
    } catch (error) {
      setStatus(messageOf(error));
    }
  };

  const allowFolder = async () => {
    setBusy(true);
    setStatus("");
    try {
      await api("/api/data-connections/folders", { method: "POST", body: JSON.stringify({ path: folder }) });
      setFolder("");
      await load();
    } catch (error) {
      setStatus(messageOf(error));
    } finally {
      setBusy(false);
    }
  };

  const connections = listed?.connections ?? [];
  return (
    <SettingsGroup label={t("settings.data.connections")} block="connections" description={t("settings.data.connectionsHelp")}>
      <SettingsRows>
        {listed && connections.length === 0 && <SettingsEmptyRow>{t("settings.data.connectionsEmpty")}</SettingsEmptyRow>}
        {connections.map((connection) => (
          <div key={connection.name} className="flex min-h-11 items-center gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] leading-5 text-ink">{connection.name}</div>
              <div className="truncate text-[12px] leading-4 text-ink-secondary">{connection.type} · {connection.where === "vault" ? t("settings.data.connectionVault") : connection.where}</div>
            </div>
            <button type="button" className="settings-quiet cursor-pointer" onClick={() => void test(connection.name)}>{t("settings.data.connectionTest")}</button>
            <button type="button" className="settings-quiet cursor-pointer" onClick={() => void remove(connection.name)}>{t("settings.data.connectionRemove")}</button>
          </div>
        ))}
        <div className="flex flex-col gap-3 p-4">
          <SettingsField label={t("settings.data.connectionName")}>
            <input className={SETTINGS_INPUT} value={name} autoComplete="off" spellCheck={false} onChange={(event) => setName(event.target.value)} />
          </SettingsField>
          <SettingsField label={t("settings.data.connectionType")}>
            <Select value={type} aria-label={t("settings.data.connectionType")} onChange={(event) => setType(event.target.value as ConnectionType)}>
              <option value="sqlite">sqlite</option>
              <option value="duckdb">duckdb</option>
              <option value="postgres">postgres</option>
            </Select>
          </SettingsField>
          {type === "postgres" ? (
            <SettingsField label={t("settings.data.connectionSecret")}>
              <input className={SETTINGS_INPUT} type="password" value={secret} autoComplete="new-password" spellCheck={false} onChange={(event) => setSecret(event.target.value)} />
            </SettingsField>
          ) : (
            <SettingsField label={t("settings.data.connectionPath")}>
              <input className={SETTINGS_INPUT} value={path} autoComplete="off" spellCheck={false} onChange={(event) => setPath(event.target.value)} />
            </SettingsField>
          )}
        </div>
        <SettingsFormFoot status={status ? <span role="alert">{status}</span> : undefined}>
          <button type="button" className="ui-button ui-button-primary" disabled={busy || !name.trim()} onClick={() => void add()}>{t("settings.data.connectionAdd")}</button>
        </SettingsFormFoot>
      </SettingsRows>
      <SettingsRows>
        {(listed?.folders ?? []).map((item) => (
          <div key={item} className="flex min-h-11 items-center gap-3 px-4 py-2">
            <div className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">{item}</div>
            <button type="button" className="settings-quiet cursor-pointer" onClick={() => void removeFolder(item)}>{t("settings.data.connectionRemove")}</button>
          </div>
        ))}
        <div className="p-4">
          <SettingsField label={t("settings.data.connectionFolder")}>
            <input className={SETTINGS_INPUT} value={folder} autoComplete="off" spellCheck={false} onChange={(event) => setFolder(event.target.value)} />
          </SettingsField>
        </div>
        <SettingsFormFoot>
          <button type="button" className="ui-button" disabled={busy || !folder.trim()} onClick={() => void allowFolder()}>{t("settings.data.folderAdd")}</button>
        </SettingsFormFoot>
      </SettingsRows>
    </SettingsGroup>
  );
}
