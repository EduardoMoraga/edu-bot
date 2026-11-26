// Publish runs only for EduardoMoraga/edu-bot. The upstream fetch uses an
// anonymous URL, and the only ref this process may push is
// refs/heads/upstream-sync on origin. The Actions token cannot push to
// milind-soni/OpenMausBot; these checks stop a mis-aimed `gh` call from
// opening a pull request or issue there anyway.

import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const FORK_REPO = "EduardoMoraga/edu-bot";
export const UPSTREAM_REPO = "milind-soni/OpenMausBot";
export const DEFAULT_UPSTREAM_URL = "https://github.com/milind-soni/OpenMausBot.git";
export const SYNC_BRANCH = "upstream-sync";
export const BASE_BRANCH = "main";
export const MARKER = "<!-- upstream-sync-report -->";
export const LABEL = "upstream-sync";
const UPSTREAM_REF = "refs/remotes/upstream/main";
const OURS_REF = "refs/remotes/origin/main";
const SUBJECT_LIMIT = 8;
const EDU_PATH_LIMIT = 80;

const REMOVED_WORKFLOWS = [
  ".github/workflows/browser-vendor-windows.yml",
  ".github/workflows/connector-e2e.yml",
  ".github/workflows/connector-release.yml",
  ".github/workflows/contributors.yml",
  ".github/workflows/docker.yml",
  ".github/workflows/npm-package.yml",
  ".github/workflows/package-linux.yml",
  ".github/workflows/package-win.yml",
  ".github/workflows/podman-service.yml",
  ".github/workflows/prepare-release.yml",
  ".github/workflows/promote-stable.yml",
  ".github/workflows/server-installer.yml",
  ".github/workflows/server-update-e2e.yml",
  ".github/workflows/sync-published-release.yml",
  ".github/workflows/windows-defender-check.yml",
];

const REMOVED_ANALYTICS = [
  "docs/analytics.md",
  "apps/docs/content/docs/security/analytics.mdx",
  "electron/launch-analytics.mjs",
  "electron/launch-analytics.node-test.mjs",
  "src/lib/analytics.ts",
  "src/lib/analytics.test.ts",
  "src/lib/analytics.wire.test.ts",
  "src/lib/analytics-allowlist.ts",
  "src/lib/analytics-allowlist.test.ts",
  "src/lib/product-events.ts",
  "src/lib/product-events.test.ts",
  "src/components/AnalyticsRow.tsx",
  "src/hooks/use-usage-snapshot.ts",
  "src/hooks/use-usage-snapshot.test.ts",
  "src/lib/usage-snapshot.ts",
  "src/lib/usage-snapshot.test.ts",
];

/** Paths Edu maintains. An upstream edit here is a conflict risk even when git can auto-merge. */
export const EDU_OWNED = [
  { match: "exact", path: "README.md", kind: "identity", reason: "English readme, rewritten for Edu Bot" },
  { match: "exact", path: "README.es.md", kind: "identity", reason: "Spanish readme; this file is Edu's" },
  { match: "exact", path: "DESIGN.md", kind: "identity", reason: "Edu design rules" },
  { match: "exact", path: "NOTICE", kind: "identity", reason: "Attribution text Edu edited" },
  { match: "exact", path: "LICENSING.md", kind: "identity", reason: "Fork attribution" },
  { match: "exact", path: "package.json", kind: "identity", reason: "Product name, version, and scripts" },
  { match: "exact", path: "electron-builder.yml", kind: "identity", reason: "App id, install paths, and the publish repository" },
  { match: "exact", path: "electron/app-identity.mjs", kind: "identity", reason: "Runtime product identity" },
  { match: "exact", path: "electron/app-identity.d.mts", kind: "identity", reason: "Runtime product identity types" },
  { match: "exact", path: "electron/desktop-updates.mjs", kind: "identity", reason: "Updates come from this repository" },
  { match: "exact", path: "electron/desktop-updates.test.mjs", kind: "identity", reason: "Update-source tests" },
  { match: "exact", path: "build/linux-edubot-browser.apparmor", kind: "identity", reason: "Renamed AppArmor profile" },
  { match: "dir", path: "docs/edu-bot", kind: "edu-docs", reason: "Edu planning and operator notes" },
  { match: "exact", path: "docs/edu-brain.md", kind: "edu-docs", reason: "Edu brain docs" },
  { match: "exact", path: "docs/profiles.md", kind: "edu-docs", reason: "Profile docs" },
  { match: "exact", path: "docs/verification/antigravity-live.md", kind: "edu-docs", reason: "Edu verification note" },
  { match: "exact", path: "docs/verification/composio-own-key.md", kind: "edu-docs", reason: "Edu verification note" },
  { match: "exact", path: "docs/verification/data-connections.md", kind: "edu-docs", reason: "Edu verification note" },
  { match: "prefix", path: "server/edu-", kind: "edu-product", reason: "Edu brain, crew, and proposals" },
  { match: "dir", path: "server/profiles", kind: "edu-product", reason: "Organization profiles" },
  { match: "exact", path: "server/data/connection-routes.ts", kind: "edu-product", reason: "Edu SQL connections" },
  { match: "exact", path: "server/data/connections.test.ts", kind: "edu-product", reason: "Edu SQL connections" },
  { match: "exact", path: "server/data/connections.ts", kind: "edu-product", reason: "Edu SQL connections" },
  { match: "exact", path: "server/data/data-connections.e2e.test.ts", kind: "edu-product", reason: "Edu SQL connections" },
  { match: "exact", path: "server/data/duckdb-extensions.json", kind: "edu-product", reason: "Edu SQL connections" },
  { match: "exact", path: "server/data/extensions.ts", kind: "edu-product", reason: "Edu SQL connections" },
  { match: "exact", path: "server/data/grants.ts", kind: "edu-product", reason: "Edu SQL connections" },
  { match: "exact", path: "server/data/internal-mcp.ts", kind: "edu-product", reason: "Edu SQL connections" },
  { match: "exact", path: "server/data/live.ts", kind: "edu-product", reason: "Edu SQL connections" },
  { match: "exact", path: "server/data/local-files.test.ts", kind: "edu-product", reason: "Edu SQL connections" },
  { match: "exact", path: "server/data/local-files.ts", kind: "edu-product", reason: "Edu SQL connections" },
  { match: "exact", path: "server/data/named-read.test.ts", kind: "edu-product", reason: "Edu SQL connections" },
  { match: "exact", path: "server/data/session.ts", kind: "edu-product", reason: "Edu SQL connections" },
  { match: "exact", path: "server/data/sql-escape.test.ts", kind: "edu-product", reason: "Edu SQL connections" },
  { match: "exact", path: "server/data/sql-shape.test.ts", kind: "edu-product", reason: "Edu SQL connections" },
  { match: "exact", path: "server/data/sql-shape.ts", kind: "edu-product", reason: "Edu SQL connections" },
  { match: "exact", path: "server/routes/edu.ts", kind: "edu-product", reason: "Edu routes" },
  { match: "exact", path: "server/routes/profiles.ts", kind: "edu-product", reason: "Profile routes" },
  { match: "exact", path: "server/routes/profiles.test.ts", kind: "edu-product", reason: "Profile route tests" },
  { match: "exact", path: "server/headless/profiles.ts", kind: "edu-product", reason: "Headless profile commands" },
  { match: "exact", path: "server/headless/profiles.test.ts", kind: "edu-product", reason: "Headless profile tests" },
  { match: "exact", path: "server/host/edu-host.ts", kind: "edu-product", reason: "Edu host wiring" },
  { match: "exact", path: "server/desired-bot.ts", kind: "edu-product", reason: "Profile bot shape" },
  { match: "prefix", path: "server/composio-own-", kind: "edu-product", reason: "Composio with the user's own key" },
  { match: "exact", path: "server/composio-live.e2e.test.ts", kind: "edu-product", reason: "Own-key Composio test" },
  { match: "exact", path: "server/antigravity-live.e2e.test.ts", kind: "edu-product", reason: "Antigravity live test" },
  { match: "prefix", path: "shared/edu-", kind: "edu-product", reason: "Shared Edu types" },
  { match: "prefix", path: "shared/profile-", kind: "edu-product", reason: "Shared profile types" },
  { match: "exact", path: "shared/data-connections.ts", kind: "edu-product", reason: "Shared SQL connection types" },
  { match: "exact", path: "packages/phone-protocol/src/edu-brain.ts", kind: "edu-product", reason: "Phone protocol Edu brain types" },
  { match: "exact", path: "packages/phone-protocol/src/data-connections.ts", kind: "edu-product", reason: "Phone protocol SQL types" },
  { match: "exact", path: "packages/phone-protocol/src/thread-order.ts", kind: "edu-product", reason: "Thread order types" },
  { match: "dir", path: "skills/edu-crew", kind: "edu-product", reason: "Edu crew skill" },
  { match: "prefix", path: "src/components/Edu", kind: "edu-product", reason: "Edu chat and mascot UI" },
  { match: "dir", path: "src/components/profiles", kind: "edu-product", reason: "Profile UI" },
  { match: "exact", path: "src/components/AppsKeySetup.tsx", kind: "edu-product", reason: "Own Composio key setup" },
  { match: "exact", path: "src/components/ThemeEditor.tsx", kind: "edu-product", reason: "Edu theme editor" },
  { match: "exact", path: "src/components/bot-panel/EduBrainCard.tsx", kind: "edu-product", reason: "Edu brain card" },
  { match: "exact", path: "src/components/bot-panel/EduBrainCard.dom.test.ts", kind: "edu-product", reason: "Edu brain card test" },
  { match: "exact", path: "src/components/bot-settings/DataSection.tsx", kind: "edu-product", reason: "Per-bot data access" },
  { match: "exact", path: "src/components/bot-settings/BotAccessSummary.tsx", kind: "edu-product", reason: "Bot access summary" },
  { match: "exact", path: "src/components/bot-settings/BotAccessSummary.dom.test.ts", kind: "edu-product", reason: "Bot access summary test" },
  { match: "exact", path: "src/components/settings/DataConnectionsSection.tsx", kind: "edu-product", reason: "SQL connection settings" },
  { match: "exact", path: "src/components/settings/pages/ProfilesPage.tsx", kind: "edu-product", reason: "Profiles settings page" },
  { match: "prefix", path: "src/lib/edu-", kind: "edu-product", reason: "Edu client helpers" },
  { match: "exact", path: "src/lib/profile-plan-view.ts", kind: "edu-product", reason: "Profile plan view" },
  { match: "exact", path: "src/lib/server-labels.ts", kind: "edu-product", reason: "Edu Bot server labels" },
  { match: "exact", path: "src/lib/engine-reason.ts", kind: "edu-product", reason: "Engine reason copy" },
  { match: "exact", path: "src/lib/email-gate.ts", kind: "edu-product", reason: "Email gate copy" },
  { match: "exact", path: "server/vault/mcp-header-keys.ts", kind: "edu-product", reason: "MCP header key storage" },
  { match: "dir", path: "enterprise", kind: "removed", reason: "Edu removed the enterprise tree from the open-source app" },
  { match: "exact", path: ".github/CODEOWNERS", kind: "removed", reason: "Edu removed upstream code owners" },
  ...REMOVED_WORKFLOWS.map((path) => ({ match: "exact", path, kind: "removed", reason: "Edu removed this upstream workflow" })),
  ...REMOVED_ANALYTICS.map((path) => ({ match: "exact", path, kind: "removed", reason: "Edu removed analytics and phone-home" })),
  { match: "exact", path: ".github/workflows/release.yml", kind: "release", reason: "Edu release workflow" },
  { match: "exact", path: ".github/workflows/ci.yml", kind: "release", reason: "Edu CI workflow" },
  { match: "exact", path: ".github/workflows/ci-stop-closed.yml", kind: "release", reason: "Edu CI cleanup workflow" },
  { match: "exact", path: ".github/workflows/docs.yml", kind: "release", reason: "Edu docs workflow" },
  { match: "exact", path: ".github/workflows/dev-desktop-setup.yml", kind: "release", reason: "Edu desktop setup workflow" },
  { match: "exact", path: ".github/workflows/shared-terminal-smoke.yml", kind: "release", reason: "Edu smoke workflow" },
  { match: "exact", path: ".github/workflows/upstream-sync.yml", kind: "release", reason: "This report workflow" },
  { match: "exact", path: "scripts/upstream-sync.mjs", kind: "release", reason: "This report script" },
  { match: "exact", path: "scripts/upstream-sync.test.ts", kind: "release", reason: "This report's tests" },
  { match: "exact", path: "scripts/release-ci.mjs", kind: "release", reason: "Edu release helper" },
  { match: "exact", path: "scripts/edu-release.test.ts", kind: "release", reason: "Edu release tests" },
  { match: "exact", path: "scripts/strip-linux-rpm-feed.mjs", kind: "release", reason: "Edu package feed strip" },
  { match: "exact", path: "scripts/dev-desktop-setup.mjs", kind: "release", reason: "Edu desktop setup helper" },
  { match: "exact", path: "src/locales/en.json", kind: "copy", reason: "English copy Edu keeps complete" },
  { match: "exact", path: "src/locales/es.json", kind: "copy", reason: "Spanish copy Edu keeps complete" },
];

export const SECURITY_RULES = [
  { id: "cve", re: /\bCVE-\d{4}-\d{4,}\b/i },
  { id: "ghsa", re: /\bGHSA(?:-[23456789cfghjmpqrvwx]{4}){3}\b/i },
  { id: "vulnerability", re: /\bvulnerabilit(?:y|ies)\b/i },
  { id: "security-fix", re: /\bsecurity (?:fix|patch|advisory|issue|hole|update)\b/i },
  { id: "xss", re: /\bXSS\b/ },
  { id: "csrf", re: /\bCSRF\b/ },
  { id: "ssrf", re: /\bSSRF\b/ },
  { id: "rce", re: /\bRCE\b|\bremote code execution\b/i },
  { id: "path-traversal", re: /\bpath traversal\b/i },
  { id: "auth-bypass", re: /\b(?:authentication|authorization|auth) bypass\b/i },
  { id: "privilege-escalation", re: /\bprivilege escalation\b/i },
  { id: "credential-leak", re: /\b(?:credential|secret|token)s? (?:leak|leaked|exposure|exposed)\b/i },
  { id: "sandbox-escape", re: /\bsandbox escape\b/i },
  { id: "injection", re: /\b(?:sql|command|header|prompt) injection\b/i },
];

const AREA_ORDER = ["server", "src", "electron", "shared", "packages", "scripts", "docs", "github", "apps", "other"];

export function matchEduOwned(file) {
  for (const rule of EDU_OWNED) {
    if (rule.match === "exact" && file === rule.path) return rule;
    if (rule.match === "dir" && (file === rule.path || file.startsWith(`${rule.path}/`))) return rule;
    if (rule.match === "prefix" && file.startsWith(rule.path)) return rule;
  }
  return null;
}

export function areaForPath(file) {
  if (file.startsWith("apps/docs/") || file.startsWith("docs/")) return "docs";
  if (file.startsWith(".github/")) return "github";
  if (file.startsWith("server/")) return "server";
  if (file.startsWith("src/")) return "src";
  if (file.startsWith("electron/")) return "electron";
  if (file.startsWith("shared/")) return "shared";
  if (file.startsWith("packages/")) return "packages";
  if (file.startsWith("scripts/")) return "scripts";
  if (file.startsWith("apps/")) return "apps";
  return "other";
}

export function securityHits(text) {
  return SECURITY_RULES.filter((rule) => rule.re.test(text)).map((rule) => rule.id);
}

export function expandNumstatPath(field) {
  const brace = field.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
  if (brace) return [`${brace[1]}${brace[2]}${brace[4]}`, `${brace[1]}${brace[3]}${brace[4]}`];
  const arrow = " => ";
  if (field.includes(arrow)) return field.split(arrow);
  return [field];
}

export function parseNumstatLog(text) {
  const commits = [];
  for (const chunk of text.split("\x1e")) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const nl = trimmed.indexOf("\n");
    const header = nl === -1 ? trimmed : trimmed.slice(0, nl);
    const rest = nl === -1 ? "" : trimmed.slice(nl + 1);
    const [sha, date, subject] = header.split("\x1f");
    if (!sha || !date || subject === undefined) continue;
    const files = [];
    for (const line of rest.split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      files.push(...expandNumstatPath(parts.slice(2).join("\t")));
    }
    commits.push({ sha, date, subject, files: [...new Set(files)] });
  }
  return commits;
}

export function parseMessageLog(text) {
  const commits = [];
  for (const chunk of text.split("\x1e")) {
    if (!chunk.trim()) continue;
    const [sha, date, subject, body = ""] = chunk.replace(/^\n/, "").split("\x1f");
    if (!sha || !subject) continue;
    commits.push({ sha: sha.trim(), date, subject, body });
  }
  return commits;
}

export function parseConflicts(text) {
  const items = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("CONFLICT ")) continue;
    const content = line.match(/^CONFLICT \(content\): Merge conflict in (.+)$/);
    if (content) {
      items.push({ kind: "content", path: content[1], line });
      continue;
    }
    const modifyDelete = line.match(/^CONFLICT \(modify\/delete\): (.+?) deleted in /);
    if (modifyDelete) {
      items.push({ kind: "modify/delete", path: modifyDelete[1], line });
      continue;
    }
    const renameDelete = line.match(/^CONFLICT \(rename\/delete\): .+ renamed to (.+?) in /);
    if (renameDelete) {
      items.push({ kind: "rename/delete", path: renameDelete[1], line });
      continue;
    }
    items.push({ kind: "other", path: null, line });
  }
  return items;
}

function primaryArea(files) {
  const counts = new Map();
  for (const file of files) counts.set(areaForPath(file), (counts.get(areaForPath(file)) || 0) + 1);
  let best = "other";
  let bestCount = -1;
  for (const area of AREA_ORDER) {
    const count = counts.get(area) || 0;
    if (count > bestCount) {
      best = area;
      bestCount = count;
    }
  }
  return best;
}

function shortSha(sha) {
  return sha.slice(0, 12);
}

export function decide(report) {
  if (report.behind === 0) return "current";
  if (report.clean) return "draft-pr";
  return "issue";
}

export function assembleReport(input) {
  const firstParent = input.firstParent;
  const firstParentShas = new Set(firstParent.map((commit) => commit.sha));
  const touched = new Set(input.cumulativeFiles);
  for (const commit of firstParent) for (const file of commit.files) touched.add(file);
  const conflicts = input.conflictRecords.map((conflict) => ({
    ...conflict,
    edu: conflict.path ? matchEduOwned(conflict.path) : null,
  }));
  const security = [];
  for (const commit of input.messages) {
    const rules = securityHits(`${commit.subject}\n${commit.body || ""}`);
    if (rules.length === 0) continue;
    security.push({
      sha: commit.sha,
      date: commit.date,
      subject: commit.subject,
      rules,
      onMain: firstParentShas.has(commit.sha),
    });
  }
  const eduTouched = [...touched]
    .map((file) => ({ file, rule: matchEduOwned(file) }))
    .filter((item) => item.rule)
    .sort((a, b) => a.file.localeCompare(b.file));
  const areas = AREA_ORDER.map((name) => {
    const commits = firstParent.filter((commit) => primaryArea(commit.files) === name);
    return {
      name,
      files: input.cumulativeFiles.filter((file) => areaForPath(file) === name).length,
      commits: commits.length,
      subjects: commits.slice(0, SUBJECT_LIMIT).map((commit) => ({ sha: commit.sha, date: commit.date, subject: commit.subject })),
      older: Math.max(0, commits.length - SUBJECT_LIMIT),
    };
  }).filter((area) => area.files > 0 || area.commits > 0);
  const report = {
    measuredAt: input.measuredAt,
    fork: input.fork,
    ours: input.ours,
    upstream: input.upstream,
    ahead: input.ahead,
    behind: input.behind,
    firstParentCount: firstParent.length,
    clean: conflicts.length === 0,
    conflicts,
    security,
    advisories: input.advisories,
    eduTouched,
    eduCommits: firstParent.filter((commit) => commit.files.some((file) => matchEduOwned(file))).length,
    areas,
    decision: "issue",
  };
  report.decision = decide(report);
  return report;
}

function titleFor(report) {
  if (report.decision === "current") return "Upstream sync: Edu main is current";
  if (report.decision === "draft-pr") return `Upstream sync: ${report.behind} commits behind (draft, do not merge)`;
  return `Upstream sync: ${report.behind} commits behind, ${report.conflicts.length} conflicts`;
}

export function renderReport(report) {
  const lines = [];
  lines.push(MARKER);
  lines.push(`# ${titleFor(report)}`);
  lines.push("");
  lines.push("Report id: upstream-sync-report");
  lines.push("");
  lines.push(`Measured ${report.measuredAt}.`);
  lines.push("");
  lines.push(`Edu main \`${shortSha(report.ours.sha)}\` (${report.ours.date}) is **${report.behind} commits behind** ${UPSTREAM_REPO} main \`${shortSha(report.upstream.sha)}\` (${report.upstream.date}) and **${report.ahead} commits ahead**.`);
  lines.push(`${report.firstParentCount} of the commits behind are the ones that landed on upstream main. The rest arrived inside those merges.`);
  lines.push(`The histories split at \`${shortSha(report.fork.sha)}\` (${report.fork.date}): ${report.fork.subject}`);
  lines.push("");
  if (report.decision === "current") {
    lines.push("Edu main already contains upstream main. Nothing was pushed.");
  } else if (report.decision === "draft-pr") {
    lines.push(`The merge into \`${BASE_BRANCH}\` is clean. A **draft** pull request on branch \`${SYNC_BRANCH}\` carries it. Do not merge it unless a person chooses to take these changes.`);
  } else {
    lines.push(`The merge into \`${BASE_BRANCH}\` conflicts in ${report.conflicts.length} path${report.conflicts.length === 1 ? "" : "s"}. No branch was pushed. This issue is the report.`);
  }
  lines.push("");
  lines.push("This run does not merge, does not push to `main`, and does not open or push anything on `milind-soni/OpenMausBot`.");
  lines.push("");
  lines.push("## Security fixes");
  lines.push("");
  if (report.security.length === 0) {
    lines.push("No new upstream commit matched a security-fix marker: CVE id, GHSA id, vulnerability, security fix, XSS, CSRF, SSRF, remote code execution, path traversal, authentication bypass, privilege escalation, credential leak, sandbox escape, or SQL, command, header, or prompt injection.");
  } else {
    lines.push(`${report.security.length} commit${report.security.length === 1 ? "" : "s"} matched a security-fix marker:`);
    lines.push("");
    for (const commit of report.security) {
      const where = commit.onMain ? "landed on upstream main" : "inside a merged branch";
      lines.push(`- \`${shortSha(commit.sha)}\` ${commit.subject} (${commit.rules.join(", ")}; ${where})`);
    }
  }
  lines.push("");
  if (report.advisories.skipped) {
    lines.push("Public GitHub security advisories were not checked in this run.");
  } else if (!report.advisories.ok) {
    lines.push(`Public GitHub security advisories could not be read (${report.advisories.error}). This is not a claim that none exist.`);
  } else if (report.advisories.items.length === 0) {
    lines.push(`No public security advisory on ${UPSTREAM_REPO} was published after the fork point.`);
  } else {
    lines.push("Public security advisories published after the fork point:");
    lines.push("");
    for (const item of report.advisories.items) {
      lines.push(`- ${item.ghsa} (${item.severity || "unspecified"}) ${item.summary || ""}`.trim());
    }
  }
  lines.push("");
  lines.push("## Edu-owned paths upstream changed");
  lines.push("");
  lines.push(`${report.eduCommits} commit${report.eduCommits === 1 ? "" : "s"} on upstream main touch an Edu-owned path. ${report.eduTouched.length} Edu-owned path${report.eduTouched.length === 1 ? "" : "s"} changed since the fork point.`);
  lines.push("The path list is `EDU_OWNED` in `scripts/upstream-sync.mjs`, explained in `docs/edu-bot/upstream-sync.md`.");
  if (report.eduTouched.length === 0) {
    lines.push("");
    lines.push("None.");
  } else {
    lines.push("");
    const shown = report.eduTouched.slice(0, EDU_PATH_LIMIT);
    for (const item of shown) lines.push(`- \`${item.file}\` — ${item.rule.reason}`);
    if (report.eduTouched.length > shown.length) lines.push(`- … and ${report.eduTouched.length - shown.length} more`);
  }
  lines.push("");
  lines.push("## By area");
  lines.push("");
  lines.push("File counts are the net diff from the fork point to upstream main. Commit counts are upstream main's own commits (newest first), grouped by the area they change most.");
  lines.push("");
  for (const area of report.areas) {
    lines.push(`### ${area.name}`);
    lines.push("");
    lines.push(`${area.files} file${area.files === 1 ? "" : "s"} in the net diff, ${area.commits} commit${area.commits === 1 ? "" : "s"} on upstream main.`);
    if (area.subjects.length) {
      lines.push("");
      for (const commit of area.subjects) lines.push(`- \`${shortSha(commit.sha)}\` ${commit.subject}`);
      if (area.older) lines.push(`- … ${area.older} older commits in this area`);
    }
    lines.push("");
  }
  lines.push("## Git conflicts");
  lines.push("");
  if (report.clean) {
    lines.push("None. `git merge-tree` merged upstream main into Edu main without a conflict.");
  } else {
    const eduConflicts = report.conflicts.filter((conflict) => conflict.edu);
    const other = report.conflicts.filter((conflict) => !conflict.edu);
    lines.push(`${eduConflicts.length} on Edu-owned paths, ${other.length} on shared paths.`);
    if (eduConflicts.length) {
      lines.push("");
      lines.push("Edu-owned:");
      lines.push("");
      for (const conflict of eduConflicts) {
        lines.push(`- \`${conflict.path || "(unparsed)"}\` (${conflict.kind}) — ${conflict.edu.reason}`);
      }
    }
    if (other.length) {
      lines.push("");
      lines.push("Other:");
      lines.push("");
      for (const conflict of other) lines.push(`- \`${conflict.path || conflict.line}\` (${conflict.kind})`);
    }
  }
  lines.push("");
  lines.push("## What was not done");
  lines.push("");
  lines.push("- No merge to `main`.");
  lines.push("- No push to `main`.");
  lines.push("- No pull request, issue, or push on `milind-soni/OpenMausBot`.");
  if (report.decision === "draft-pr") lines.push(`- Branch \`${SYNC_BRANCH}\` was updated and the pull request was left as a draft.`);
  if (report.decision === "issue") lines.push("- `upstream-sync` was not updated, because the merge conflicts.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function assertUpstreamUrl(url, env) {
  if (!url || url.includes("@") || /token/i.test(url)) {
    throw new Error("refusing an upstream URL that carries credentials");
  }
  if (url === DEFAULT_UPSTREAM_URL || url === "https://github.com/milind-soni/OpenMausBot") return;
  if (env.UPSTREAM_SYNC_ALLOW_FILE_URL === "1" && url.startsWith("file:")) return;
  throw new Error("refusing an upstream URL that is not milind-soni/OpenMausBot");
}

export function assertForkRepo(repo) {
  if (!repo || repo === UPSTREAM_REPO || repo.endsWith("/OpenMausBot")) {
    throw new Error("refusing to publish on the upstream repository");
  }
  if (repo !== FORK_REPO) throw new Error(`refusing to publish outside ${FORK_REPO}`);
}

export function pushArgs(remoteSha) {
  const refspec = `HEAD:refs/heads/${SYNC_BRANCH}`;
  if (refspec !== "HEAD:refs/heads/upstream-sync") throw new Error("refusing refspec");
  if (remoteSha !== null && !/^[0-9a-f]{40}$/.test(remoteSha)) throw new Error("refusing lease sha");
  if (remoteSha) return ["push", `--force-with-lease=refs/heads/upstream-sync:${remoteSha}`, "origin", refspec];
  return ["push", "origin", refspec];
}

function git(cwd, args) {
  const result = spawnSync("git", ["-c", "core.quotePath=false", ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `git ${args[0]} failed`).trim());
  return result.stdout;
}

function refExists(cwd, ref) {
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", ref], { cwd, encoding: "utf8" });
  return result.status === 0;
}

function tip(cwd, ref) {
  const [sha, date, subject] = git(cwd, ["log", "-1", "--format=%H%x1f%cI%x1f%s", ref]).trim().split("\x1f");
  return { sha, date, subject };
}

function fetchUpstream(cwd, url, env) {
  assertUpstreamUrl(url, env);
  // Developer machines rewrite https://github.com/ to a credentialed URL.
  // Drop global git config for this fetch so that rewrite cannot attach a
  // token to the upstream read. Actions keeps its checkout credential in the
  // repo-local extraheader, which -c clears for this command only.
  const result = spawnSync(
    "git",
    ["-c", "credential.helper=", "-c", "http.extraheader=", "fetch", "--no-tags", url, `+refs/heads/main:${UPSTREAM_REF}`],
    {
      cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
    },
  );
  if (result.status !== 0) throw new Error((result.stderr || "upstream fetch failed").trim());
}

async function fetchAdvisories(sinceIso) {
  const url = `https://api.github.com/repos/${UPSTREAM_REPO}/security-advisories?per_page=100`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "edu-bot-upstream-sync" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { ok: false, skipped: false, error: `HTTP ${response.status}`, items: [] };
    const data = await response.json();
    if (!Array.isArray(data)) return { ok: false, skipped: false, error: "unexpected response", items: [] };
    const since = Date.parse(sinceIso);
    const items = data
      .filter((item) => !item.published_at || Number.isNaN(since) || Date.parse(item.published_at) >= since)
      .map((item) => ({ ghsa: item.ghsa_id, severity: item.severity, published: item.published_at, summary: item.summary }));
    return { ok: true, skipped: false, items };
  } catch (error) {
    return { ok: false, skipped: false, error: error instanceof Error ? error.message : "fetch failed", items: [] };
  }
}

export async function measure(cwd, options = {}) {
  if (!refExists(cwd, OURS_REF)) throw new Error("origin/main is missing; refusing to measure a branch other than the fork's main");
  if (!refExists(cwd, UPSTREAM_REF)) throw new Error("upstream main is missing; fetch it before measuring");
  const ours = tip(cwd, OURS_REF);
  const upstream = tip(cwd, UPSTREAM_REF);
  const forkSha = git(cwd, ["merge-base", OURS_REF, UPSTREAM_REF]).trim();
  const fork = tip(cwd, forkSha);
  const ahead = Number(git(cwd, ["rev-list", "--count", `${UPSTREAM_REF}..${OURS_REF}`]).trim());
  const behind = Number(git(cwd, ["rev-list", "--count", `${OURS_REF}..${UPSTREAM_REF}`]).trim());
  const firstParent = parseNumstatLog(git(cwd, ["log", "--first-parent", "--numstat", "--format=%x1e%H%x1f%cI%x1f%s", `${forkSha}..${UPSTREAM_REF}`]));
  const messages = parseMessageLog(git(cwd, ["log", "--format=%x1e%H%x1f%cI%x1f%s%x1f%b", `${forkSha}..${UPSTREAM_REF}`]));
  const cumulativeFiles = git(cwd, ["diff", "--name-only", forkSha, UPSTREAM_REF]).split("\n").map((line) => line.trim()).filter(Boolean);
  const merge = spawnSync("git", ["merge-tree", "--write-tree", "--messages", OURS_REF, UPSTREAM_REF], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (merge.status !== 0 && merge.status !== 1) throw new Error((merge.stderr || "merge-tree failed").trim());
  const conflictRecords = parseConflicts(`${merge.stdout || ""}\n${merge.stderr || ""}`);
  if (merge.status === 1 && conflictRecords.length === 0) throw new Error("merge-tree failed without a conflict list");
  if (merge.status === 0 && conflictRecords.length > 0) throw new Error("merge-tree reported conflicts with a clean status");
  const advisories = options.advisories ?? (options.skipAdvisories ? { ok: false, skipped: true, items: [] } : await fetchAdvisories(fork.date));
  return assembleReport({
    measuredAt: options.measuredAt ?? new Date().toISOString(),
    fork,
    ours,
    upstream,
    ahead,
    behind,
    firstParent,
    cumulativeFiles,
    conflictRecords,
    messages,
    advisories,
  });
}

function ghBin(env) {
  // Actions sets GITHUB_ACTIONS on the test job too. An explicit GH_BIN is the test double.
  if (env.GH_BIN) return env.GH_BIN;
  if (env.GITHUB_ACTIONS === "true") return "gh";
  throw new Error("refusing to call gh outside GitHub Actions");
}

function spawnGh(env, args) {
  const bin = ghBin(env);
  // Windows cannot execute the test double: it is a shebang script, not a .exe. The real gh stays a direct spawn.
  const command = env.GH_BIN ? process.execPath : bin;
  const commandArgs = env.GH_BIN ? [bin, ...args] : args;
  return spawnSync(command, commandArgs, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GH_REPO: FORK_REPO, GH_PROMPT_DISABLED: "1" },
  });
}

function gh(env, args) {
  if (args.includes(UPSTREAM_REPO) || args.some((arg) => arg.includes("milind-soni"))) {
    throw new Error("refusing a gh call aimed at the upstream repository");
  }
  if (!args.includes("--repo") || args[args.indexOf("--repo") + 1] !== FORK_REPO) {
    throw new Error("refusing a gh call without --repo EduardoMoraga/edu-bot");
  }
  const result = spawnGh(env, args);
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || result.error?.message || `gh ${args[0]} failed`).trim());
  return result.stdout.trim();
}

function withBody(env, args, body) {
  const dir = mkdtempSync(join(tmpdir(), "upstream-sync-"));
  const file = join(dir, "report.md");
  try {
    writeFileSync(file, body);
    return gh(env, [...args, "--body-file", file]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function ensureLabel(env) {
  const listed = JSON.parse(gh(env, ["label", "list", "--repo", FORK_REPO, "--search", LABEL, "--limit", "20", "--json", "name"]));
  if (listed.some((label) => label.name === LABEL)) return true;
  const created = spawnGh(env, ["label", "create", LABEL, "--repo", FORK_REPO, "--color", "1d76db", "--description", "Weekly upstream drift report"]);
  if (created.status !== 0 && !/already exists/i.test(`${created.stderr}\n${created.stdout}`)) return false;
  return true;
}

function findIssue(env) {
  const raw = gh(env, ["issue", "list", "--repo", FORK_REPO, "--state", "all", "--limit", "20", "--search", `${MARKER.slice(4, -4).trim()} in:body`, "--json", "number,state"]);
  const items = JSON.parse(raw);
  items.sort((a, b) => b.number - a.number);
  return items[0] ?? null;
}

function findPull(env) {
  const raw = gh(env, ["pr", "list", "--repo", FORK_REPO, "--head", `${FORK_REPO.split("/")[0]}:${SYNC_BRANCH}`, "--base", BASE_BRANCH, "--state", "open", "--json", "number,isDraft,url"]);
  const items = JSON.parse(raw);
  return items[0] ?? null;
}

function issuesDisabled(error) {
  return /disabled issues|issues are disabled|issues disabled/i.test(error instanceof Error ? error.message : String(error));
}

function upsertIssue(env, report, body) {
  try {
    const labeled = ensureLabel(env);
    const title = titleFor(report);
    const existing = findIssue(env);
    if (!existing) {
      const args = ["issue", "create", "--repo", FORK_REPO, "--title", title];
      if (labeled) args.push("--label", LABEL);
      withBody(env, args, body);
      return;
    }
    const args = ["issue", "edit", String(existing.number), "--repo", FORK_REPO, "--title", title];
    if (labeled) args.push("--add-label", LABEL);
    withBody(env, args, body);
    if (existing.state === "CLOSED" || existing.state === "closed") {
      gh(env, ["issue", "reopen", String(existing.number), "--repo", FORK_REPO]);
    }
  } catch (error) {
    if (!issuesDisabled(error)) throw error;
    throw new Error(
      "GitHub Issues are disabled on EduardoMoraga/edu-bot. Enable them under Settings → General → Features → Issues. The report is in the job summary. No pull request was opened.",
    );
  }
}

function closeIssue(env, comment) {
  const existing = findIssue(env);
  if (!existing || existing.state === "CLOSED" || existing.state === "closed") return;
  gh(env, ["issue", "close", String(existing.number), "--repo", FORK_REPO, "--comment", comment]);
}

function upsertPull(env, report, body) {
  const title = titleFor(report);
  const existing = findPull(env);
  let number;
  if (!existing) {
    const url = withBody(env, ["pr", "create", "--repo", FORK_REPO, "--base", BASE_BRANCH, "--head", SYNC_BRANCH, "--draft", "--title", title], body);
    const match = url.match(/\/pull\/(\d+)/);
    number = match ? match[1] : null;
  } else {
    number = String(existing.number);
    withBody(env, ["pr", "edit", number, "--repo", FORK_REPO, "--title", title], body);
    if (!existing.isDraft) gh(env, ["pr", "ready", number, "--undo", "--repo", FORK_REPO]);
  }
  return number;
}

function closeDraftPull(env, comment) {
  const existing = findPull(env);
  if (!existing) return;
  if (!existing.isDraft) {
    gh(env, ["pr", "comment", String(existing.number), "--repo", FORK_REPO, "--body", comment]);
    return;
  }
  gh(env, ["pr", "close", String(existing.number), "--repo", FORK_REPO, "--comment", comment]);
}

function abortMerge(cwd) {
  const mergeHead = spawnSync("git", ["rev-parse", "--verify", "--quiet", "MERGE_HEAD"], { cwd, encoding: "utf8" });
  if (mergeHead.status === 0) spawnSync("git", ["merge", "--abort"], { cwd });
}

function remoteSyncSha(cwd) {
  const probe = spawnSync("git", ["fetch", "origin", `refs/heads/${SYNC_BRANCH}:refs/remotes/origin/${SYNC_BRANCH}`], {
    cwd,
    encoding: "utf8",
  });
  if (probe.status !== 0) return null;
  return git(cwd, ["rev-parse", `refs/remotes/origin/${SYNC_BRANCH}`]).trim();
}

function pushSyncBranch(cwd) {
  const branch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (branch !== SYNC_BRANCH) throw new Error(`refusing to push from ${branch}`);
  const result = spawnSync("git", pushArgs(remoteSyncSha(cwd)), { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error((result.stderr || "push failed").trim());
}

function mergeAndPush(cwd, oursSha) {
  const previous = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  try {
    git(cwd, ["checkout", "-B", SYNC_BRANCH, oursSha]);
    const message = "Merge upstream main into upstream-sync\n\nReport-only draft. Do not merge this pull request.\n";
    const merge = spawnSync(
      "git",
      ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "merge", "--no-ff", "--no-edit", "-m", message, UPSTREAM_REF],
      { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    if (merge.status !== 0) {
      const conflicts = parseConflicts(`${merge.stdout}\n${merge.stderr}`);
      return {
        pushed: false,
        conflicts: conflicts.length ? conflicts : [{ kind: "other", path: null, line: "git merge stopped without a clean result" }],
      };
    }
    const headBranch = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    const firstParent = git(cwd, ["rev-parse", "HEAD^1"]).trim();
    if (headBranch !== SYNC_BRANCH || firstParent !== oursSha) {
      throw new Error("refusing to push: the merge is not upstream-sync based on origin/main");
    }
    pushSyncBranch(cwd);
    return { pushed: true, conflicts: [] };
  } finally {
    abortMerge(cwd);
    const current = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8" });
    if (current.status === 0 && current.stdout.trim() !== previous) git(cwd, ["checkout", previous]);
  }
}

function writeSummary(env, markdown) {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
}

export async function publish(cwd, env) {
  assertForkRepo(env.GITHUB_REPOSITORY);
  const dry = env.UPSTREAM_SYNC_DRY_RUN === "1";
  if (env.GITHUB_ACTIONS !== "true" && env.UPSTREAM_SYNC_PUBLISH !== "1" && !dry) {
    throw new Error("refusing to publish outside GitHub Actions");
  }
  const url = env.UPSTREAM_FETCH_URL || DEFAULT_UPSTREAM_URL;
  fetchUpstream(cwd, url, env);
  const skipAdvisories = env.UPSTREAM_SYNC_ALLOW_FILE_URL === "1";
  let report = await measure(cwd, { skipAdvisories });
  let pushed = false;
  if (!dry && report.decision === "draft-pr") {
    const oursSha = git(cwd, ["rev-parse", OURS_REF]).trim();
    const merged = mergeAndPush(cwd, oursSha);
    pushed = merged.pushed;
    if (!merged.pushed) {
      const conflicts = merged.conflicts.map((conflict) => ({
        ...conflict,
        edu: conflict.path ? matchEduOwned(conflict.path) : null,
      }));
      report = { ...report, clean: false, conflicts, decision: "issue" };
    }
  }
  const body = renderReport(report);
  writeSummary(env, body);
  if (dry) {
    process.stdout.write(body);
    process.stderr.write(`dry-run decision: ${report.decision}\n`);
    return { decision: report.decision, pushed: false };
  }
  if (report.decision === "draft-pr") {
    if (!pushed) throw new Error("refusing to open a pull request without a push of upstream-sync");
    upsertPull(env, report, body);
    closeIssue(env, "Upstream main merges cleanly. The report now lives on the draft pull request. This issue is closed without a merge.");
  } else if (report.decision === "issue") {
    upsertIssue(env, report, body);
    closeDraftPull(env, "This week's merge conflicts, so upstream-sync was not updated. The report is on the upstream-sync issue. This draft was closed without a merge.");
  } else {
    closeIssue(env, "Edu main already contains upstream main. Closed without a merge.");
    closeDraftPull(env, "Edu main already contains upstream main. Closed without a merge.");
  }
  process.stdout.write(body);
  return { decision: report.decision, pushed };
}

async function main() {
  const command = process.argv[2] || "report";
  const cwd = process.cwd();
  if (command === "report") {
    const offline = process.argv.includes("--offline");
    const skipAdvisories = process.argv.includes("--no-advisories") || process.env.UPSTREAM_SYNC_ALLOW_FILE_URL === "1";
    if (!offline) fetchUpstream(cwd, process.env.UPSTREAM_FETCH_URL || DEFAULT_UPSTREAM_URL, process.env);
    const report = await measure(cwd, { skipAdvisories });
    const body = renderReport(report);
    writeSummary(process.env, body);
    process.stdout.write(body);
    return;
  }
  if (command === "publish") {
    await publish(cwd, process.env);
    return;
  }
  throw new Error(`unknown command ${command}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
