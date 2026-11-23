import { approvalModeFor, withinApprovalCeiling } from "../../../shared/approval-mode";
import { intlLocale, t } from "@/lib/i18n";
import { mcpServersForBot, useMcpServers } from "@/lib/mcp-servers";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import type { Bot } from "@/state/store";
import { useStoreDispatch } from "@/state/store-select";
import { useBotApps, type BotAppsState } from "./useBotApps";

export function BotAccessSummary({ bot, loadedApps }: { bot: Bot; loadedApps?: BotAppsState }) {
  const dispatch = useStoreDispatch();
  const admin = useOwnerOrAdmin();
  const mcp = useMcpServers();
  const lookup = useBotApps(bot, loadedApps === undefined);
  const apps = loadedApps ?? lookup;
  const list = (items: string[]) => new Intl.ListFormat(intlLocale()).format(items);
  const mode = withinApprovalCeiling(approvalModeFor(bot), bot.approvalCeiling);
  const servers = mcp.servers && mcpServersForBot(mcp.servers, bot.mcpServers, bot.id);
  const connected = apps.apps.filter((app) => app.scope !== null).map((app) => app.label);
  const data = Object.entries(bot.dataConnections ?? {});
  const allowed = bot.toolScope?.allow;
  const denied = bot.toolScope?.deny ?? [];
  const groupsOff = (bot.toolsOff ?? []).map((group) => t(`botAccess.toolGroups.${group}`));

  return (
    <section className="space-y-2 rounded-xl bg-card p-4" aria-label={t("botAccess.summary.title")} data-bot-access-summary>
      <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{t("botAccess.summary.title")}</h3>
      <ul className="space-y-1 break-words text-[13px] text-ink-secondary">
        <li>{t("botAccess.summary.approval", { mode: t(`approvalMode.${mode}.label`) })}{" "}
          {bot.approvalCeiling ? t("botAccess.summary.ceiling", { mode: t(`approvalMode.${bot.approvalCeiling}.label`) }) : t("botAccess.summary.noCeiling")}</li>
        <li>{allowed ? (allowed.length ? t("botAccess.summary.tools", { names: list(allowed) }) : t("botAccess.summary.noTools")) : t("botAccess.summary.allTools")}</li>
        {denied.length > 0 && <li>{t("botAccess.summary.denied", { names: list(denied) })}</li>}
        {groupsOff.length > 0 && <li>{t("botAccess.summary.groupsOff", { names: list(groupsOff) })}</li>}
        <li>{servers ? (servers.length ? t("botAccess.summary.mcp", { names: list(servers.map((server) => server.name)) }) : t("botAccess.summary.noMcp"))
          : t(mcp.error ? "botAccess.summary.mcpUnavailable" : "botAccess.summary.mcpLoading")}</li>
        <li>{apps.phase === "ready" || bot.composio === false
          ? (connected.length ? t("botAccess.summary.apps", { names: list(connected) }) : t("botAccess.summary.noApps"))
          : t(apps.inventorySettled ? "botAccess.summary.appsUnavailable" : "botAccess.summary.appsLoading")}</li>
        {data.length === 0 && <li>{t("botAccess.summary.noData")}</li>}
        {data.map(([name, grant]) => <li key={name}>
          {grant.tables?.length ? t("botAccess.summary.tables", { name, tables: list(grant.tables) }) : t("botAccess.summary.allTables", { name })}{" "}
          {grant.schemas?.length ? t("botAccess.summary.schemas", { schemas: list(grant.schemas) }) : null}
        </li>)}
      </ul>
      {admin && !window.ogb?.remoteClient?.active && <button type="button" className="text-start text-[13px] text-accent-text underline"
        onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "activity", activityBot: bot.id })}>
        {t("botAccess.summary.activity")}
      </button>}
    </section>
  );
}
