import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { engineReady } from "@/components/EngineLibrary";
import { brand, productName } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { aiChoices, aiWorks, firstAis, type FirstAiKind } from "@/lib/onboarding";
import { useStore, type InstanceInfo } from "@/state/store";
import { freeFallback } from "../../../shared/ai-ranking";
import { ConnectAiDialog } from "./ConnectAi";
import { PILL, SignInPill, useSignInPill } from "./SignInPill";
import { aiRuns, useWelcomeAi } from "./welcome-ai";

const APP_ICON_SIZE = 72;
const LINES = ["onboarding.meet.line1", "onboarding.meet.line2", "onboarding.meet.line3"] as const;

/** The first run's first screen: a welcome, three short lines on what the app does, then one pill. With no AI working
 * yet the pills are the sign-ins (Claude, ChatGPT and OpenCode), and the pill to start comes once the AI has answered its
 * test message. */
export function MeetScreen({ hosted, onNext }: { hosted: boolean; onNext: () => void }) {
  const { state } = useStore();
  // An AI counts once it answered a test message (or cannot be sent one); OpenCode's free model only once picked here.
  const [chosen, setChosen] = useState<string | null>(null);
  const tested = useWelcomeAi(state.instances, !hosted, chosen);
  const ready = aiWorks(tested);
  const known = state.instances.length > 0;
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (hosted || !known || tested?.state === "testing") return;
    if (!ready) setAsking(true);
  }, [hosted, known, ready, tested]);
  const works = (instance: InstanceInfo) => aiRuns(instance) && !freeFallback(instance);
  // Picked and installed, still listing its models: its pill waits until its test message.
  const settling = (instance: InstanceInfo | undefined) => Boolean(instance && instance.instanceId === chosen && engineReady(instance) && !aiRuns(instance));
  const first = firstAis(state.instances, works).filter(({ instance }) => !works(instance) && (instance.install || engineReady(instance)));
  const { recommended } = aiChoices(state.instances.filter((instance) => instance.install && !engineReady(instance)));
  const choice = (kind: FirstAiKind) => first.find((entry) => entry.kind === kind)?.instance;
  const lead = first.length ? undefined : recommended;
  const pills = {
    claude: useSignInPill(choice("claude") ?? lead),
    chatgpt: useSignInPill(choice("chatgpt")),
    opencode: useSignInPill(choice("opencode")),
  };
  const shown = first.length ? first : [{ kind: "claude" as const, instance: lead }];
  const [dialog, setDialog] = useState(false);

  const logo = brand().logo;

  const testing = tested?.state === "testing" ? tested.instance.instanceId : null;
  const waitsFor = shown.some(({ instance }) => instance?.instanceId === testing) ? testing : shown[0]?.instance?.instanceId;
  const failure = shown.map(({ kind }) => pills[kind].error).find(Boolean)
    ?? (tested?.state === "failed" ? tested.error ?? t("onboarding.engines.noAnswer", { name: tested.instance.displayName }) : null);
  const signingIn = asking && !ready;
  return (
    <div className="relative h-full min-h-[600px] w-full text-center">
      <h1 id="welcome-title" className="absolute left-1/2 top-[calc(50%-264px)] w-max max-w-[min(560px,calc(100%-32px))] -translate-x-1/2 text-[28px] font-normal leading-[34px] tracking-[-0.02em] text-ink">
        {t("onboarding.meet.placeholder", { app: productName() })}
      </h1>
      <span className="absolute left-1/2 top-[calc(50%-150px)] flex -translate-x-1/2 -translate-y-1/2" style={{ width: APP_ICON_SIZE, height: APP_ICON_SIZE }}>
        <img src={logo ?? "/app-icon.svg"} alt="" width={APP_ICON_SIZE} height={APP_ICON_SIZE} className="size-full object-contain" />
      </span>
      <ul data-welcome-lines="" className="absolute left-1/2 top-[calc(50%-84px)] flex w-max max-w-[calc(100%-32px)] -translate-x-1/2 flex-col gap-3 text-start text-[17px] leading-6 text-ink">
        {LINES.map((line) => (
          <li key={line} className="flex items-start gap-3">
            <Check size={18} strokeWidth={2.25} aria-hidden="true" className="mt-[3px] shrink-0 text-success" />
            <span>{t(line)}</span>
          </li>
        ))}
      </ul>
      {hosted && (
        <p className="absolute left-1/2 top-[calc(50%+86px)] w-[420px] max-w-[calc(100%-32px)] -translate-x-1/2 text-[13px] leading-[18px] text-ink-secondary">
          {t("onboarding.hosted.intro")}
        </p>
      )}
      <div className={cn("absolute left-1/2 flex w-[320px] max-w-[calc(100%-32px)] -translate-x-1/2 flex-col items-center",
        signingIn ? "top-[min(calc(50%+200px),calc(100%-180px))]" : "top-[calc(50%+200px)]")}>
        {asking && ready && tested && (
          <p role="status" data-ai-connected="" className="absolute -top-8 flex items-center gap-1.5 whitespace-nowrap text-[13px] leading-[18px] text-success">
            <Check size={14} strokeWidth={2.5} aria-hidden="true" />{t("onboarding.meet.connected", { name: tested.instance.displayName })}
          </p>
        )}
        {signingIn ? (
          <div data-first-ais="" className="flex flex-col items-center gap-2">
            {shown.map(({ kind, instance }, index) => (
              <SignInPill key={kind} pill={pills[kind]} instance={instance} quiet={index > 0}
                name={kind === "chatgpt" ? t("cloudSignIn.codex") : undefined}
                setUp={kind === "chatgpt" && instance?.snapshot.state !== "available"}
                waiting={(testing !== null && instance?.instanceId === waitsFor) || settling(instance)}
                onDialog={() => setDialog(true)} onPick={instance && (() => setChosen(instance.instanceId))} />
            ))}
          </div>
        ) : (
          <button type="button" data-primary="" onClick={onNext} className={cn(PILL, asking && "animate-fade-in [animation-duration:150ms]")}>
            {t("onboarding.meet.start")}
          </button>
        )}
        {signingIn && (
          <p className="mt-3 text-[13px] leading-[18px] text-ink-secondary">
            <button type="button" onClick={() => setDialog(true)} className="rounded transition-colors hover:text-ink">{t("onboarding.meet.otherWays")}</button>
            <span aria-hidden="true"> · </span>
            <button type="button" data-welcome-later="" onClick={onNext} className="rounded transition-colors hover:text-ink">{t("onboarding.meet.setupLater")}</button>
          </p>
        )}
        {signingIn && failure && <p role="alert" className="mt-2 text-[13px] leading-[18px] text-danger">{failure}</p>}
      </div>
      {dialog && <ConnectAiDialog hosted={hosted} tested={tested} onChoose={setChosen} onClose={() => setDialog(false)} />}
    </div>
  );
}
