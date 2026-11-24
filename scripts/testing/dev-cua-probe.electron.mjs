// Run by Electron itself, from the source tree, the way `pnpm dev:desktop` runs the app: it starts computer control
// exactly as the app does and writes what it found. Used by .github/workflows/dev-desktop-setup.yml.
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

const out = process.env.DEV_CUA_PROBE_OUT;
const write = (result) => {
  const text = JSON.stringify(result, null, 2);
  if (out) fs.writeFileSync(out, text);
  console.log(text);
};

const root = path.join(import.meta.dirname, "..", "..");
app.setAppPath(root);
app.setPath("userData", fs.mkdtempSync(path.join(app.getPath("temp"), "dev-cua-probe-")));

app.whenReady().then(async () => {
  const result = { platform: process.platform, arch: process.arch, packaged: app.isPackaged, appPath: app.getAppPath() };
  try {
    const cua = await import("../../electron/cua.mjs");
    result.binary = cua.resolveDriverBinary();
    result.binaryExists = Boolean(result.binary && fs.existsSync(result.binary));
    result.staged = Boolean(result.binary && result.binary.startsWith(path.join(app.getAppPath(), "dist-native")));
    const connection = await cua.startCua({ attempt: 99 });
    result.mode = connection?.mode ?? null;
    result.reason = connection?.reason ?? null;
    await cua.stopCua?.();
  } catch (error) {
    result.error = error instanceof Error ? error.stack ?? error.message : String(error);
  }
  write(result);
  app.exit(0);
});
