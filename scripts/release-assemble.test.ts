import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

type Step = { run?: string };
const release = parse(readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8")) as {
  jobs: { assemble: { steps: Step[] } };
};
const assemble = release.jobs.assemble.steps.find((step) => step.run?.includes("gh release create"))!.run!;
const VERSION = "9.9.9";
const ASSETS = [
  `EduBot-${VERSION}-arm64.dmg`, `EduBot-${VERSION}-arm64.dmg.blockmap`, `EduBot-${VERSION}-arm64.zip`,
  `EduBot-${VERSION}-arm64.zip.blockmap`, `EduBot-${VERSION}-x64.dmg`, `EduBot-${VERSION}-x64.dmg.blockmap`,
  `EduBot-${VERSION}-x64.zip`, `EduBot-${VERSION}-x64.zip.blockmap`, `EduBot-${VERSION}-setup.exe`,
  `EduBot-${VERSION}-setup.exe.blockmap`, `EduBot-${VERSION}-amd64.deb`, `EduBot-${VERSION}-x86_64.AppImage`,
  "latest-mac.yml", "latest-mac.yml.sig", "latest.yml", "latest.yml.sig", "latest-linux.yml", "latest-linux.yml.sig",
  "model-manifest.json", "SHA256SUMS",
];

// A stand-in for the gh CLI that answers like GitHub's release API on a bad day: the create returns HTTP 500 after it
// made the draft, and listed uploads fail a set number of times first.
const FAKE_GH = `#!/usr/bin/env bash
echo "$*" >> "$STATE/calls"
case "$1 $2" in
  "api "*) echo "refs/tags/v${VERSION}" ;;
  "release view")
    [ -f "$STATE/draft" ] || { echo "release not found" >&2; exit 1; }
    case "$*" in
      *isDraft*) echo true ;;
      *) name=$(printf '%s' "$*" | sed -n 's/.*select(.name == "\\([^"]*\\)").*/\\1/p'); cat "$STATE/size-$name" 2>/dev/null ;;
    esac ;;
  "release create")
    touch "$STATE/draft"
    [ -f "$STATE/created" ] || { touch "$STATE/created"; echo "HTTP 500: Internal Server Error" >&2; exit 1; } ;;
  "release upload")
    name=$(basename "$4"); left=$(cat "$STATE/fail-$name" 2>/dev/null || echo 0)
    if [ "$left" -gt 0 ]; then echo $((left - 1)) > "$STATE/fail-$name"; echo "HTTP 500" >&2; exit 1; fi
    stat -c %s "$4" > "$STATE/size-$name" ;;
  *) echo "unexpected gh $*" >&2; exit 2 ;;
esac
`;

let root = "";
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function run(failures: Record<string, number>) {
  root = mkdtempSync(join(tmpdir(), "release-assemble-"));
  const bin = join(root, "bin");
  const state = join(root, "state");
  const work = join(root, "work");
  for (const dir of [bin, state, join(work, "assets")]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(bin, "gh"), FAKE_GH);
  writeFileSync(join(bin, "sleep"), "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(bin, "gh"), 0o755);
  chmodSync(join(bin, "sleep"), 0o755);
  for (const [index, name] of ASSETS.entries()) writeFileSync(join(work, "assets", name), "x".repeat(index + 1));
  for (const os of ["mac", "windows", "linux"]) writeFileSync(join(work, "assets", `SIGNING-${os}.txt`), `${os}: unsigned\n`);
  for (const [name, count] of Object.entries(failures)) writeFileSync(join(state, `fail-${name}`), String(count));
  const result = spawnSync("bash", ["-c", assemble], {
    cwd: work,
    encoding: "utf8",
    env: {
      PATH: `${bin}:${process.env.PATH}`, STATE: state, RUNNER_TEMP: root, EVENT: "push", REF_TYPE: "tag",
      DRY_RUN: "", VERSION, SHA: "abc123", GITHUB_REPOSITORY: "EduardoMoraga/edu-bot",
    },
  });
  const calls = readFileSync(join(state, "calls"), "utf8").trim().split("\n");
  return { status: result.status, stderr: result.stderr, stdout: result.stdout, calls };
}

describe.skipIf(process.platform === "win32")("release assemble step", () => {
  it("rides out GitHub 500s: one draft, every installer uploaded, sizes checked", () => {
    const { status, stdout, calls } = run({ [`EduBot-${VERSION}-x64.zip`]: 2, "latest.yml": 1 });
    expect(status).toBe(0);
    expect(calls.filter((call) => call.startsWith("release create"))).toHaveLength(1);
    expect(stdout).toContain(`using the draft for v${VERSION}`);
    const uploads = calls.filter((call) => call.startsWith("release upload")).map((call) => call.split(" ")[3]);
    expect(new Set(uploads)).toEqual(new Set(ASSETS.map((name) => `assets/${name}`)));
    expect(uploads.filter((file) => file.endsWith("-x64.zip"))).toHaveLength(3);
    expect(stdout).toContain("The desktop app updates itself on Windows and Linux");
  });

  it("stops when an upload keeps failing, so no release goes out without an installer", () => {
    const { status, stderr } = run({ "latest-linux.yml": 99 });
    expect(status).not.toBe(0);
    expect(stderr).toContain("HTTP 500");
  });
});
