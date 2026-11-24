import path from "node:path";

const MAC_INSTALLED = "/Applications/CuaDriver.app/Contents/MacOS/cua-driver";

/** Where `pnpm dev:desktop` stages the driver for this computer (scripts/dev-desktop-setup.mjs), or null where it stages none. */
export function stagedDevDriver({ platform, arch, appPath }) {
  if (platform === "darwin") return path.join(appPath, "dist-native", arch, "cua-driver");
  if (platform === "win32") return path.join(appPath, "dist-native", "cua-win32-x64", "cua-driver.exe");
  return null;
}

/**
 * The cua-driver executable this run uses, and whether this app must host it itself (`embedded`) so the operating system
 * attributes screen control to this app instead of to a driver app installed separately.
 */
export function resolveDriver({ env, packaged, platform, arch, resourcesPath, appPath, windowsInstalled = [], exists }) {
  const embeddedAsked = platform === "win32" || packaged || env.OPENMAUSBOT_CUA_EMBEDDED === "1";
  if (env.CUA_DRIVER_PATH) return { binary: env.CUA_DRIVER_PATH, embedded: embeddedAsked };
  if (packaged) {
    const bundled = path.join(resourcesPath, platform === "win32" ? "cua-driver.exe" : "cua-driver");
    if (exists(bundled)) return { binary: bundled, embedded: true };
  }
  const staged = packaged ? null : stagedDevDriver({ platform, arch, appPath });
  if (staged && exists(staged)) return { binary: staged, embedded: true };
  if (platform === "darwin" && exists(MAC_INSTALLED)) return { binary: MAC_INSTALLED, embedded: embeddedAsked };
  if (platform === "win32") {
    const installed = windowsInstalled.find((candidate) => exists(candidate));
    if (installed) return { binary: installed, embedded: true };
  }
  return { binary: null, embedded: embeddedAsked };
}
