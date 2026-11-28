import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { productName } from "../lib/brand";
import { pageIsThisComputer } from "../lib/companion-bridge";
import type { TailnetComputer, TailnetComputers as TailnetComputersList, TailnetShareState } from "../lib/companion-types";
import { companionBridge, usePhoneSetupController, type CompanionState, type PhoneSetupController } from "./PhoneSetupFlow";
import { deriveTailscalePairingStatus, type TailscalePairingStatus } from "./PhoneDevicesSection";
import { useStore } from "@/state/store";
import { ServerPairingCard } from "./ServerPairingCard";
import { SettingRow, SettingsEmptyRow, SettingsGroup, SettingsRows, StatusDot, Switch } from "./SettingsPrimitives";

/** What the row says about the share right now; null while it is off. */
export function tailnetShareLine(share: TailnetShareState | undefined): string | null {
  if (!share?.on) return null;
  if (!share.origin) return t("devices.computers.waiting", { app: productName() });
  return t(share.https ? "devices.computers.https" : share.httpsPortBusy ? "devices.computers.httpPortBusy" : "devices.computers.http", { address: share.origin });
}

/** Why Tailscale is not ready, in the Tailscale check's own words; null while it is off, or on and fine. */
function tailscaleTrouble(status: TailscalePairingStatus): string | null {
  if (status.kind !== "not-installed" && status.kind !== "signed-out" && status.kind !== "magicdns") return null;
  return status.detail ? `${status.title} ${status.detail}` : status.title;
}

/** Your other computers: lets them open this one over Tailscale, and makes them a pairing link. */
export function TailnetComputers({ c, state, blocked, simple, status }: { c: PhoneSetupController; state: CompanionState; blocked: string | null; simple: boolean; status: TailscalePairingStatus }) {
  const on = state.routes?.tailscale?.on === true && state.routes.tailscale.computers === true;
  const trouble = tailscaleTrouble(status);
  // On with nothing answering: Tailscale's own reason says what to fix; "isn't connected yet" is only for when it gives none.
  const line = on && !(trouble && !state.tailnetShare?.origin) ? tailnetShareLine(state.tailnetShare) : null;
  const address = on ? state.tailnetShare?.origin ?? null : null;
  return (
    <>
      <SettingsGroup block="computers">
        <SettingsRows>
          <SettingRow title={t("devices.computers.title")} subtitle={t("devices.computers.detail")}
            message={line || trouble || blocked ? <span data-tailnet-share={line ? "" : undefined} data-tailnet-trouble={!line && trouble ? status.kind : undefined} className="break-words" aria-live="polite">{line ?? trouble ?? blocked}</span> : undefined}>
            <span data-route-row="tailscale-computers" className="contents">
              {!on && status.kind === "not-installed" && <a href="https://tailscale.com/download" target="_blank" rel="noreferrer" className="ui-button">{t("remote.tailscale.getIt")}</a>}
              <Switch checked={on} aria-label={t("devices.computers.title")} disabled={c.busy || c.accountBusy || (Boolean(blocked) && !on)} title={blocked ?? undefined}
                onClick={() => void c.act((companion) => companion.setTailscaleComputers?.(!on) ?? companion.state())} />
            </span>
          </SettingRow>
        </SettingsRows>
      </SettingsGroup>
      {address && <ServerPairingCard simple={simple} reveal={false} forComputer address={address} />}
    </>
  );
}

/** The same row wherever it is shown outside its Settings page: its own link to the app, the organization's policy and Tailscale's state. */
export function OtherComputersSetting({ simple = true }: { simple?: boolean }) {
  const c = usePhoneSetupController(useStore().state.config?.profile?.email);
  const policy = useStore().state.config?.managedPolicy;
  if (!c.state) return null;
  const blocked = policy?.remoteAccess === false ? t("policy.managedBy", { organization: policy.organizationName }) : null;
  return <TailnetComputers c={c} state={c.state} blocked={blocked} simple={simple} status={deriveTailscalePairingStatus(c.state)} />;
}

export const MY_COMPUTERS_REFRESH_MS = 60_000;

export type MyComputersView = TailnetComputersList | "loading" | "failed";

/** The list while it is on screen: once at once, then every minute while the window is visible; nothing once it closes. */
function useMyComputers(source: () => Promise<TailnetComputersList>): MyComputersView {
  const [view, setView] = useState<MyComputersView>("loading");
  useEffect(() => {
    let live = true;
    let busy = false;
    const look = () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      source().then((next) => { if (live) setView(next); }, () => { if (live) setView("failed"); }).finally(() => { busy = false; });
    };
    look();
    const timer = window.setInterval(look, MY_COMPUTERS_REFRESH_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [source]);
  return view;
}

const OS_NAMES: Record<string, string> = { windows: "Windows", linux: "Linux", android: "Android", macos: "macOS", ios: "iOS", freebsd: "FreeBSD" };

function computerLine(computer: TailnetComputer, allows: boolean): string {
  const app = productName();
  const status = computer.status === "eduBot"
    ? computer.version ? t("devices.mine.eduBotVersion", { app, version: computer.version }) : t("devices.mine.eduBot", { app })
    : computer.status === "noEduBot" ? t("devices.mine.noEduBot", { app }) : t("devices.mine.offline");
  const os = computer.os ? OS_NAMES[computer.os.toLowerCase()] ?? computer.os : null;
  const uses = computer.allowed && computer.folders?.length ? t("computers.uses", { folders: computer.folders.join(", ") })
    : allows && computer.status === "eduBot" && !computer.trust ? t("computers.update", { app }) : null;
  return [os, status, uses].filter(Boolean).join(" · ");
}

/** Always allow, for a computer that can be allowed now or is allowed already. */
function canSwitch(computer: TailnetComputer): boolean {
  return computer.allowed === true || (computer.status === "eduBot" && computer.trust === true);
}

/** Computers: the person's own other computers on Tailscale, which have Edu Bot open, and, with `onAllow`, one Always
 * allow switch each. */
export function MyComputersList({ view, onAllow, busy = null, problem = null }: { view: MyComputersView; onAllow?: (computer: TailnetComputer, on: boolean) => void;
  busy?: string | null; problem?: { id: string; text: string } | null }) {
  const app = productName();
  const empty = view === "loading" ? t("devices.mine.looking")
    : view === "failed" ? t("devices.mine.failed")
    : view.tailscale === "off" ? t("devices.mine.tailscaleOff")
    : view.tailscale === "unreadable" ? t("devices.mine.tailscaleUnreadable", { app })
    : view.computers.some((computer) => computer.status === "eduBot") ? null : t("devices.mine.none", { app, switch: t("devices.computers.title") });
  const computers = typeof view === "object" && view.tailscale === "ready" ? view.computers : [];
  return (
    <SettingsGroup block="my-computers" label={t(onAllow ? "computers.title" : "devices.mine.title")} description={onAllow ? t("computers.detail") : t("devices.mine.detail", { app })}>
      <SettingsRows>
        {empty && <SettingsEmptyRow><span aria-live="polite" data-my-computers-empty="">{empty}</span></SettingsEmptyRow>}
        {computers.map((computer) => (
          <SettingRow key={computer.id} title={computer.name}
            subtitle={<span data-my-computer={computer.status}><StatusDot tone={computer.status === "eduBot" ? "success" : null} />{computerLine(computer, Boolean(onAllow))}</span>}
            message={problem?.id === computer.id ? <span className="text-danger" aria-live="polite">{problem.text}</span> : undefined}>
            {onAllow && canSwitch(computer) ? <span data-always-allow={computer.id} className="contents">
              <span className="text-[13px] text-ink-secondary">{t("computers.allow")}</span>
              <Switch checked={computer.allowed === true} disabled={busy !== null} aria-label={t("computers.allowFor", { name: computer.name })}
                onClick={() => onAllow(computer, computer.allowed !== true)} />
            </span> : null}
          </SettingRow>
        ))}
      </SettingsRows>
    </SettingsGroup>
  );
}

/** Only in the desktop app's own window for this computer: Computers with Always allow on an app that has it, else the list. */
export function MyComputers() {
  const [bridge] = useState(() => (pageIsThisComputer() ? companionBridge() : undefined));
  if (bridge?.computers && bridge.allowComputer && bridge.stopComputer) {
    return <Computers source={bridge.computers} allow={bridge.allowComputer} stop={bridge.stopComputer} />;
  }
  return bridge?.tailnetComputers ? <ShownMyComputers source={bridge.tailnetComputers} /> : null;
}

function ShownMyComputers({ source }: { source: () => Promise<TailnetComputersList> }) {
  return <MyComputersList view={useMyComputers(source)} />;
}

const message = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : String(error));

function Computers({ source, allow, stop }: { source: () => Promise<TailnetComputersList>; allow: (id: string) => Promise<boolean>; stop: (id: string) => Promise<void> }) {
  const listed = useMyComputers(source);
  // The list read after a switch, until the next minute's read replaces it.
  const [after, setAfter] = useState<{ view: TailnetComputersList; over: MyComputersView } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ id: string; text: string } | null>(null);
  const onAllow = (computer: TailnetComputer, on: boolean) => {
    const over = listed;
    setBusy(computer.id);
    setProblem(null);
    (on ? allow(computer.id).then(() => undefined) : stop(computer.id))
      .catch((error: unknown) => setProblem({ id: computer.id, text: message(error) }))
      .then(() => source())
      .then((view) => setAfter({ view, over }), () => {})
      .finally(() => setBusy(null));
  };
  return <MyComputersList view={after && after.over === listed ? after.view : listed} onAllow={onAllow} busy={busy} problem={problem} />;
}
