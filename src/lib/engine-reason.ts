import { tFromServer } from "@/lib/i18n";

/** Only `engine.reason.*` keys are taken, so a server cannot make the app show any other catalog string. */
export function engineReason(snapshot: { reason?: string; reasonKey?: string; reasonParams?: Record<string, string> }): string | undefined {
  if (!snapshot.reason || !snapshot.reasonKey?.startsWith("engine.reason.")) return snapshot.reason;
  return tFromServer(snapshot.reasonKey, snapshot.reason, snapshot.reasonParams);
}
