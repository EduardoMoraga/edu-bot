// Windows CI runs this suite 1.4-1.5x slower than Linux, and a Linux shard that runs several files at once
// (OMB_VITEST_WORKERS, scripts/ci-scope.mjs) shares its CPU between them, so every test and hook timeout doubles there
// (vite.config.ts scales the defaults; explicit timeouts use hostTimeout()). CI's macOS shards run on GitHub's Intel
// runners, which time out 20-second tests that pass on Apple silicon, so Intel macOS doubles too. One file at a time on
// Linux and Apple-silicon macOS stays strict.
const sideBySide = Number(process.env.OMB_VITEST_WORKERS) > 1;
const intelMac = process.platform === "darwin" && process.arch === "x64";
export const HOST_TIMEOUT_FACTOR = process.platform === "win32" || intelMac || sideBySide ? 2 : 1;

export function hostTimeout(ms: number): number {
  return ms * HOST_TIMEOUT_FACTOR;
}
