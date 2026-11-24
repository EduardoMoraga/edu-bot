import type { ProviderSnapshot } from "../../contracts.ts";

type ProbeReason = Required<Pick<ProviderSnapshot, "reason" | "reasonKey" | "reasonParams">>;

export const PROBE_REASONS = {
  "engine.reason.cliMissing": "`{cli}` isn't installed, or isn't on this app's PATH. Install it for the user running Edu Bot or use Set CLI, then check again.",
  "engine.reason.cliNotExecutable": "`{cli}` isn't executable. Check its file permissions, then check again.",
  "engine.reason.cliTimedOut": "`{cli}` version check timed out after 8 seconds. Check it in a terminal on the server, then try again.",
  "engine.reason.cliFailed": "`{cli}` version check failed. Run it with --version on the server to diagnose the installation, then check again.",
  "engine.reason.cliNoVersion": "`{cli}` returned no version. Check the configured executable with --version, then try again.",
} as const;

function reason(key: keyof typeof PROBE_REASONS, cli: string): ProbeReason {
  return { reason: PROBE_REASONS[key].replace("{cli}", cli), reasonKey: key, reasonParams: { cli } };
}

/** Why `cli --version` failed, never its output or environment. */
export function cliProbeFailure(cli: string, failure: NodeJS.ErrnoException & { killed?: boolean }): ProbeReason {
  if (failure.code === "ENOENT") return reason("engine.reason.cliMissing", cli);
  if (failure.code === "EACCES" || failure.code === "EPERM") return reason("engine.reason.cliNotExecutable", cli);
  return reason(failure.killed && failure.code == null ? "engine.reason.cliTimedOut" : "engine.reason.cliFailed", cli);
}

export function cliWithoutVersion(cli: string): ProbeReason {
  return reason("engine.reason.cliNoVersion", cli);
}
