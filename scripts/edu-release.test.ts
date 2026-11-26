import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const builder = parse(read("electron-builder.yml")) as {
  appId: string;
  productName: string;
  artifactName: string;
  publish: { provider: string; owner: string; repo: string }[];
  win?: { publisherName?: string; target: { target: string; arch: string | string[] }[] };
  nsis: { shortcutName: string; uninstallDisplayName: string; artifactName: string };
  dmg: { title: string; artifactName: string; sign: boolean };
  linux: { executableName: string; desktop: { entry: { Name: string } }; target: { target: string; arch: string[] }[] };
  mac: { target: { target: string; arch: string | string[] }[] };
};
const releaseText = read(".github/workflows/release.yml");
const release = parse(releaseText) as {
  on: { push: { tags: string[] }; workflow_dispatch: { inputs: { dry_run: { type: string; default: boolean }; ship_without_ci: { default: boolean } } } };
  jobs: Record<string, { needs?: string | string[] }>;
};

function resourcePaths(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) resourcePaths(item, found);
  } else if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.from === "string") found.push(record.from);
    if (typeof record.to === "string") found.push(record.to);
    for (const child of Object.values(record)) resourcePaths(child, found);
  }
  return found;
}

describe("Edu Bot 0.2.0 release metadata", () => {
  it("pins package.json and the released data format to 0.2.0", () => {
    expect(JSON.parse(read("package.json")).version).toBe("0.2.0");
    expect(JSON.parse(read("server/data-format-released.json")).version).toBe("0.2.0");
  });

  it("does not package Android platform-tools or Chrome for Testing", () => {
    const prepare = JSON.parse(read("package.json")).scripts["package:prepare"] as string;
    expect(prepare).not.toContain("build:browser");
    expect(prepare).not.toContain("build:android-tools");
    const paths = resourcePaths(builder);
    const joined = paths.join("\n");
    expect(joined).not.toContain("android-platform-tools");
    expect(joined).not.toContain("browser-engine");
    expect(joined).not.toContain("dist-native/browser");
  });

  it("ships the 0.45.4 CUA license set on macOS and Windows", () => {
    const text = read("electron-builder.yml");
    const mac = text.slice(text.indexOf("\nmac:"), text.indexOf("\ndmg:"));
    const win = text.slice(text.indexOf("\nwin:"), text.indexOf("\nnsis:"));
    const notices = [
      "third_party/cua-driver-0.45.4/LICENSE.md",
      "third_party/cua-driver-0.45.4/Inter-OFL-1.1.txt",
      "third_party/cua-driver-0.45.4/THIRD_PARTY_NOTICES.md",
    ];
    const packaged = [
      "licenses/cua-driver-LICENSE.md",
      "licenses/cua-driver-Inter-OFL-1.1.txt",
      "licenses/cua-driver-THIRD_PARTY_NOTICES.md",
    ];
    for (const name of [...notices, ...packaged]) {
      expect(mac).toContain(name);
      expect(win).toContain(name);
    }
    const notice = read("third_party/cua-driver-0.45.4/THIRD_PARTY_NOTICES.md");
    expect(notice).toContain("0.45.4");
    expect(notice).toContain("MPL-2.0");
    expect(notice).toContain("SIL OFL 1.1");
    expect(read("third_party/cua-driver-0.45.4/LICENSE.md")).toContain("MIT License");
    expect(read("third_party/cua-driver-0.45.4/Inter-OFL-1.1.txt")).toContain("SIL OPEN FONT LICENSE");
    const doc = read("docs/edu-bot/third-party-binaries.md");
    expect(doc).toContain("resources/cua-linux-x64/cua-driver");
    expect(doc).toContain("resources/cua-linux-x64/cua-cursor-theme");
    expect(doc).toContain("0.41.3");
    expect(doc).toContain("libcua_driver_sdk.dylib");
    expect(doc).toContain("cua_driver_sdk.dll");
    expect(doc).toContain("resources/elevate.exe");
    expect(doc).toContain("0.45.4");
    expect(doc).toContain("Mirroring that exact binary onto this repository is deferred.");
    const afterPack = read("scripts/after-pack.mjs");
    for (const name of ["cua-driver-LICENSE.md", "cua-driver-Inter-OFL-1.1.txt", "cua-driver-THIRD_PARTY_NOTICES.md"]) {
      expect(afterPack).toContain(name);
      expect(releaseText.split(`$res/licenses/${name}`).length - 1).toBe(2);
    }
  });

  it("names the installers Edu Bot and publishes to this repository", () => {
    expect(builder.appId).toBe("io.github.eduardomoraga.edubot");
    expect(builder.productName).toBe("Edu Bot");
    expect(builder.publish).toEqual([{ provider: "github", owner: "EduardoMoraga", repo: "edu-bot" }]);
    expect(builder.artifactName).toBe("EduBot-${version}-${arch}.${ext}");
    expect(builder.dmg.title).toBe("Edu Bot ${version}");
    expect(builder.dmg.artifactName).toBe("EduBot-${version}-${arch}.dmg");
    expect(builder.dmg.sign).toBe(false);
    expect(builder.nsis.shortcutName).toBe("Edu Bot");
    expect(builder.nsis.uninstallDisplayName).toBe("Edu Bot");
    expect(builder.nsis.artifactName).toBe("EduBot-${version}-setup.${ext}");
    expect(builder.linux.executableName).toBe("edu-bot");
    expect(builder.linux.desktop.entry.Name).toBe("Edu Bot");
    expect(builder.win?.publisherName).toBeUndefined();
    for (const value of [
      builder.productName,
      builder.artifactName,
      builder.dmg.title,
      builder.dmg.artifactName,
      builder.nsis.shortcutName,
      builder.nsis.uninstallDisplayName,
      builder.nsis.artifactName,
      builder.linux.executableName,
      builder.linux.desktop.entry.Name,
    ]) {
      expect(value).not.toMatch(/OpenMausBot|MausBot/);
    }
    expect(builder.mac.target.map((target) => target.target).sort()).toEqual(["dmg", "zip"]);
    expect(builder.mac.target.map((target) => (Array.isArray(target.arch) ? target.arch.join() : target.arch))).toEqual(["arm64,x64", "arm64,x64"]);
    expect(builder.win?.target.map((target) => target.arch)).toEqual(["x64", "x64"]);
    expect(builder.linux.target.map((target) => target.target)).toEqual(expect.arrayContaining(["AppImage", "deb"]));
  });

  it("does not compare this version with the upstream release feed", () => {
    expect(read("electron/desktop-updates.mjs")).toContain('DESKTOP_AUTO_UPDATE_PLATFORMS = new Set(["win32", "linux"])');
    const updateCheck = read("server/update-check.ts");
    expect(updateCheck).toContain("https://api.github.com/repos/${PROJECT_REPOSITORY}/releases/latest");
    expect(updateCheck).toContain("https://raw.githubusercontent.com/${PROJECT_REPOSITORY}/channels/stable.json");
    expect(read("shared/project-repository.ts")).toContain('export const PROJECT_REPOSITORY = "EduardoMoraga/edu-bot"');
    expect(updateCheck).not.toContain("milind-soni");
  });

  it("publishes one draft from a v* tag, and a dry run publishes nothing", () => {
    expect(release.on.push.tags).toEqual(["v*"]);
    expect(release.on.workflow_dispatch.inputs.dry_run).toMatchObject({ type: "boolean", default: true });
    expect(release.on.workflow_dispatch.inputs.ship_without_ci.default).toBe(false);
    expect(release.jobs.ci?.needs).toBe("prepare");
    expect(release.jobs.assemble?.needs).toEqual(expect.arrayContaining(["ci", "mac", "windows", "linux"]));
    expect(releaseText).toContain("node scripts/record-data-format.mjs");
    expect(releaseText).toContain("--draft");
    expect(releaseText).not.toContain("--latest");
    expect(releaseText).not.toContain("milind-soni");
    expect(releaseText).not.toContain("ghcr.io");
    expect(releaseText).not.toMatch(/npm publish/);
    expect(releaseText).toContain("rpm must not be uploaded");
    expect(releaseText).toContain("latest-linux.yml must not list an rpm");
    expect(releaseText).toContain("node scripts/strip-linux-rpm-feed.mjs release/latest-linux.yml");
    expect(releaseText).toContain("node scripts/sign-update-metadata.mjs");
    expect(releaseText).toContain("EDUBOT_UPDATE_SIGNING_KEY");
    expect(releaseText).toContain("assets/model-manifest.json");
    expect(releaseText).toContain("assets/latest.yml.sig");
    const linuxUpload = releaseText.slice(releaseText.indexOf("name: linux-release"), releaseText.indexOf("assemble:"));
    expect(linuxUpload).not.toContain("rpm");
    expect(releaseText).toContain('[ "$GITHUB_REPOSITORY" = "EduardoMoraga/edu-bot" ]');
    expect(releaseText).toContain(`trap 'rm -f "$RUNNER_TEMP/cert.p12"' EXIT`);
    expect(releaseText).toContain('if [ -z "${WIN_CSC_LINK:-}" ] && [ -z "${CSC_LINK:-}" ]; then');
    const gate = 'if [ -z "${WIN_CSC_LINK:-}" ] && [ -z "${CSC_LINK:-}" ]; then\n            if grep -q "publisherName"';
    const opensUnsigned = (text: string) => text.slice(text.indexOf('if [ -z "${WIN_CSC_LINK:-}" ]')).replaceAll("\r\n", "\n").startsWith(gate);
    expect(opensUnsigned(releaseText)).toBe(true);
    expect(opensUnsigned(releaseText.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"))).toBe(true);
    expect(releaseText.toLowerCase()).not.toContain("s3://");
  });
});
