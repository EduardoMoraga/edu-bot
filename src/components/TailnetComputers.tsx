import { useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { productName } from "../lib/brand";
import { companionBridge, pageIsThisComputer } from "../lib/companion-bridge";
import type { TailnetComputer, TailnetComputers as TailnetComputersList, TailnetShareState } from "../lib/companion-types";
import { usePhoneSetupController, type CompanionState, type PhoneSetupController } from "./PhoneSetupFlow";
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
      {pageIsThisComputer() && <MyComputers />}
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
function useMyComputers(): MyComputersView {
  const [view, setView] = useState<MyComputersView>("loading");
  useEffect(() => {
    const source = companionBridge()?.tailnetComputers;
    if (!source) return;
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
  }, []);
  return view;
}

const OS_NAMES: Record<string, string> = { windows: "Windows", linux: "Linux", android: "Android", macos: "macOS", ios: "iOS", freebsd: "FreeBSD" };

function computerLine(computer: TailnetComputer): string {
  const app = productName();
  const status = computer.status === "eduBot"
    ? computer.version ? t("devices.mine.eduBotVersion", { app, version: computer.version }) : t("devices.mine.eduBot", { app })
    : computer.status === "noEduBot" ? t("devices.mine.noEduBot", { app }) : t("devices.mine.offline");
  const os = computer.os ? OS_NAMES[computer.os.toLowerCase()] ?? computer.os : null;
  return os ? `${os} · ${status}` : status;
}

/** My computers: the person's own other computers on Tailscale, and which have Edu Bot open. Only shows them. */
export function MyComputersList({ view }: { view: MyComputersView }) {
  const app = productName();
  const empty = view === "loading" ? t("devices.mine.looking")
    : view === "failed" ? t("devices.mine.failed")
    : view.tailscale === "off" ? t("devices.mine.tailscaleOff")
    : view.computers.some((computer) => computer.status === "eduBot") ? null : t("devices.mine.none", { app, switch: t("devices.computers.title") });
  const computers = typeof view === "object" && view.tailscale === "ready" ? view.computers : [];
  return (
    <SettingsGroup block="my-computers" label={t("devices.mine.title")} description={t("devices.mine.detail", { app })}>
      <SettingsRows>
        {empty && <SettingsEmptyRow><span aria-live="polite" data-my-computers-empty="">{empty}</span></SettingsEmptyRow>}
        {computers.map((computer) => (
          <SettingRow key={computer.id} title={computer.name}
            subtitle={<span data-my-computer={computer.status}><StatusDot tone={computer.status === "eduBot" ? "success" : null} />{computerLine(computer)}</span>}>
            {null}
          </SettingRow>
        ))}
      </SettingsRows>
    </SettingsGroup>
  );
}

function MyComputers() {
  return <MyComputersList view={useMyComputers()} />;
}
