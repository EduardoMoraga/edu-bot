import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function fail(message) {
  throw new Error(`[smoke-deb-upgrade] ${message}`);
}

if (process.platform !== "linux" || process.env.CI !== "true" || process.getuid?.() !== 0) {
  fail("this system-package test runs only as root on an ephemeral Linux CI runner");
}
const runnerTemp = process.env.RUNNER_TEMP;
if (!runnerTemp || !path.isAbsolute(runnerTemp) || !fs.existsSync(runnerTemp)) {
  fail("RUNNER_TEMP must be an existing absolute CI path");
}
const candidate = path.resolve(process.argv[2] ?? "");
if (!candidate.endsWith(".deb") || !fs.existsSync(candidate)) fail("pass the newly built DEB path");

function packageStatus() {
  try {
    return execFileSync("dpkg-query", ["-W", "-f=${db:Status-Abbrev}", "edu-bot"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function purgeInstalled() {
  if (!packageStatus()) return;
  execFileSync("dpkg", ["--purge", "edu-bot"], { stdio: "inherit" });
}

function installedVersion() {
  return execFileSync("dpkg-query", ["-W", "-f=${Version}", "edu-bot"], { encoding: "utf8" }).trim();
}

function aptInstall(deb) {
  // apt configures the package and resolves its declared desktop dependencies.
  // Calling dpkg directly can leave the package unconfigured on the
  // intentionally minimal runner before its post-install hook is tested.
  execFileSync("apt-get", ["install", "-y", "--no-install-recommends", deb], {
    env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
    stdio: "inherit",
  });
}

function assertUpgradedTree() {
  for (const directory of [
    "/opt/edu-bot",
    "/opt/edu-bot/resources",
    "/opt/edu-bot/resources/cua-linux-x64",
  ]) {
    const details = fs.lstatSync(directory);
    if (!details.isDirectory() || details.isSymbolicLink()) fail(`unsafe upgraded directory: ${directory}`);
    if (details.uid !== 0 || details.gid !== 0 || (details.mode & 0o777) !== 0o755) {
      fail(`upgraded directory is not root:root 0755: ${directory}`);
    }
  }
  for (const executable of ["cua-driver", "cua-cursor-theme"]) {
    const file = path.join("/opt/edu-bot/resources/cua-linux-x64", executable);
    const details = fs.lstatSync(file);
    if (!details.isFile() || details.isSymbolicLink()) fail(`unsafe upgraded executable: ${file}`);
    if (details.uid !== 0 || details.gid !== 0 || (details.mode & 0o777) !== 0o755) {
      fail(`upgraded executable is not root:root 0755: ${file}`);
    }
  }
  const chromiumSandbox = "/opt/edu-bot/chrome-sandbox";
  const sandboxDetails = fs.lstatSync(chromiumSandbox);
  if (!sandboxDetails.isFile() || sandboxDetails.isSymbolicLink()) {
    fail(`unsafe upgraded Chromium sandbox: ${chromiumSandbox}`);
  }
  if (
    sandboxDetails.uid !== 0 ||
    sandboxDetails.gid !== 0 ||
    (sandboxDetails.mode & 0o7777) !== 0o4755
  ) {
    fail(`upgraded Chromium sandbox is not root:root 4755: ${chromiumSandbox}`);
  }
}

const temporary = fs.mkdtempSync(path.join(path.resolve(runnerTemp), "omb-deb-upgrade-"));
if (path.dirname(temporary) !== path.resolve(runnerTemp)) fail("temporary fixture escaped RUNNER_TEMP");

const candidateVersion = execFileSync("dpkg-deb", ["-f", candidate, "Version"], { encoding: "utf8" }).trim();
if (!/^[0-9][0-9A-Za-z.+~:-]*$/.test(candidateVersion)) fail(`candidate version is not a Debian version: ${candidateVersion}`);
const olderVersion = `${candidateVersion}~smoke`;
const newerVersion = `${candidateVersion}+smoke`;

function stageDeb(version, { looseModes }) {
  const stage = path.join(temporary, `stage-${version.replace(/[^0-9A-Za-z.+~]/g, "_")}`);
  const controlRoot = path.join(stage, "DEBIAN");
  const app = path.join(stage, "opt", "edu-bot");
  const resources = path.join(app, "resources");
  const deb = path.join(temporary, `edu-bot_${version}_amd64.deb`);
  fs.mkdirSync(controlRoot, { recursive: true, mode: 0o755 });
  fs.mkdirSync(resources, { recursive: true, mode: looseModes ? 0o775 : 0o755 });
  if (looseModes) {
    fs.chmodSync(app, 0o775);
    fs.chmodSync(resources, 0o775);
  }
  fs.writeFileSync(
    path.join(controlRoot, "control"),
    [
      "Package: edu-bot",
      `Version: ${version}`,
      "Architecture: amd64",
      "Maintainer: Edu Bot CI <ci@edubot.invalid>",
      "Description: Edu Bot upgrade smoke fixture",
      "",
    ].join("\n"),
    { mode: 0o644 },
  );
  fs.writeFileSync(path.join(resources, "upgrade-fixture"), `${version}\n`, { mode: 0o644 });
  execFileSync("dpkg-deb", ["--build", "--root-owner-group", stage, deb], { stdio: "inherit" });
  return deb;
}

try {
  purgeInstalled();
  const olderDeb = stageDeb(olderVersion, { looseModes: true });
  execFileSync("dpkg", ["--install", olderDeb], { stdio: "inherit" });
  for (const directory of ["/opt/edu-bot", "/opt/edu-bot/resources"]) {
    const mode = fs.lstatSync(directory).mode & 0o777;
    if (mode !== 0o775) fail(`legacy fixture did not reproduce 0775 at ${directory}`);
  }

  aptInstall(candidate);
  assertUpgradedTree();
  if (installedVersion() !== candidateVersion) {
    fail(`upgrade installed ${installedVersion()}, not ${candidateVersion}`);
  }

  const newerDeb = stageDeb(newerVersion, { looseModes: false });
  execFileSync("dpkg", ["--compare-versions", candidateVersion, "lt", newerVersion], { stdio: "inherit" });
  aptInstall(newerDeb);
  if (installedVersion() !== newerVersion) {
    fail(`a later version did not upgrade ${candidateVersion} to ${newerVersion} (installed ${installedVersion()})`);
  }

  purgeInstalled();
  aptInstall(candidate);
  assertUpgradedTree();
  if (installedVersion() !== candidateVersion) {
    fail(`restored package is ${installedVersion()}, not ${candidateVersion}`);
  }
  console.log(
    `[smoke-deb-upgrade] OK: ${olderVersion} legacy modes repaired by ${candidateVersion}, and ${newerVersion} upgrades without a downgrade`,
  );
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
