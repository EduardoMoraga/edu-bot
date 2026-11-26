import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  EDU_OWNED,
  FORK_REPO,
  UPSTREAM_REPO,
  assertForkRepo,
  assertUpstreamUrl,
  assembleReport,
  decide,
  expandNumstatPath,
  matchEduOwned,
  parseConflicts,
  parseMessageLog,
  parseNumstatLog,
  publish,
  pushArgs,
  renderReport,
  securityHits,
} from "./upstream-sync.mjs";
import { parse } from "yaml";

const script = fileURLToPath(new URL("./upstream-sync.mjs", import.meta.url));
const workflowPath = fileURLToPath(new URL("../.github/workflows/upstream-sync.yml", import.meta.url));
const docPath = fileURLToPath(new URL("../docs/edu-bot/upstream-sync.md", import.meta.url));
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function gitEnv() {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function git(cwd: string, args: string[]) {
  const result = spawnSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", env: gitEnv() });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

function commitFile(cwd: string, name: string, contents: string, message: string) {
  writeFileSync(join(cwd, name), contents);
  git(cwd, ["add", name]);
  git(cwd, ["commit", "-m", message]);
}

function fixture(conflict: boolean) {
  const root = mkdtempSync(join(tmpdir(), "upstream-sync-"));
  roots.push(root);
  const origin = join(root, "origin.git");
  const upstream = join(root, "upstream");
  const fork = join(root, "fork");
  const ghLog = join(root, "gh.log");
  const ghBin = join(root, "gh");
  git(root, ["init", "--bare", "-b", "main", origin]);
  git(root, ["init", "-b", "main", upstream]);
  commitFile(upstream, "README.md", "base\n", "base");
  git(upstream, ["remote", "add", "origin", origin]);
  git(upstream, ["push", "origin", "main"]);
  git(root, ["clone", origin, fork]);
  commitFile(fork, "README.md", "edu\n", "edu readme");
  git(fork, ["push", "origin", "main"]);
  if (conflict) commitFile(upstream, "README.md", "upstream\n", "upstream readme");
  else commitFile(upstream, "OTHER.md", "new\n", "upstream file");
  writeFileSync(
    ghBin,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.GH_LOG, JSON.stringify(args) + "\\n");
if (args.some((arg) => arg.includes("milind-soni") || arg.includes("OpenMausBot"))) process.exit(3);
if (args[0] === "pr" && args[1] === "merge") process.exit(5);
const key = args[0] + " " + args[1];
if (process.env.GH_DISABLE_ISSUES === "1" && args[0] === "issue") {
  process.stderr.write("the repository has disabled issues\\n");
  process.exit(1);
}
if (key === "label list" || key === "issue list" || key === "pr list") {
  process.stdout.write("[]\\n");
  process.exit(0);
}
if (key === "label create" || key === "issue edit" || key === "pr edit" || key === "issue close" || key === "pr close") process.exit(0);
if (key === "issue create") {
  if (!args.includes("--repo") || args[args.indexOf("--repo") + 1] !== "EduardoMoraga/edu-bot") process.exit(6);
  process.stdout.write("https://github.com/EduardoMoraga/edu-bot/issues/4\\n");
  process.exit(0);
}
if (key === "pr create") {
  if (!args.includes("--draft")) process.exit(4);
  if (args[args.indexOf("--base") + 1] !== "main") process.exit(7);
  if (args[args.indexOf("--head") + 1] !== "upstream-sync") process.exit(8);
  process.stdout.write("https://github.com/EduardoMoraga/edu-bot/pull/9\\n");
  process.exit(0);
}
process.stderr.write("unexpected " + args.join(" ") + "\\n");
process.exit(1);
`,
  );
  chmodSync(ghBin, 0o755);
  return { root, origin, upstream, fork, ghLog, ghBin };
}

function publishEnv(fx: ReturnType<typeof fixture>) {
  return {
    ...gitEnv(),
    GITHUB_REPOSITORY: FORK_REPO,
    UPSTREAM_SYNC_PUBLISH: "1",
    UPSTREAM_SYNC_ALLOW_FILE_URL: "1",
    UPSTREAM_FETCH_URL: `file://${fx.upstream}`,
    GH_BIN: fx.ghBin,
    GH_LOG: fx.ghLog,
    GH_PROMPT_DISABLED: "1",
  };
}

function ghCalls(fx: ReturnType<typeof fixture>) {
  return readFileSync(fx.ghLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]);
}

describe("Edu-owned paths and security markers", () => {
  it("matches Edu paths and ignores a near miss", () => {
    expect(matchEduOwned("server/edu-brain.ts")?.kind).toBe("edu-product");
    expect(matchEduOwned("server/education.ts")).toBeNull();
    expect(matchEduOwned("docs/edu-bot/upstream-sync.md")?.kind).toBe("edu-docs");
    expect(matchEduOwned("src/components/EduMascot.tsx")?.kind).toBe("edu-product");
    expect(matchEduOwned("src/components/Editor.tsx")).toBeNull();
    expect(matchEduOwned(".github/workflows/package-win.yml")?.kind).toBe("removed");
    expect(matchEduOwned("server/data/connections.ts")?.reason).toBe("Edu SQL connections");
    expect(matchEduOwned("server/data/engine.ts")).toBeNull();
  });

  it("flags security fixes and skips ordinary sandbox or wording commits", () => {
    expect(securityHits("fix: CVE-2026-12345 in the updater")).toEqual(["cve"]);
    expect(securityHits("GHSA-2323-6789-wx9c allows XSS")).toEqual(["ghsa", "xss"]);
    expect(securityHits("Security fix: path traversal in the file tool")).toEqual(["security-fix", "path-traversal"]);
    expect(securityHits("the usage report reads the profile's file only and never runs `security`")).toEqual([]);
    expect(securityHits("files where the unprivileged server can reach them")).toEqual([]);
    expect(securityHits("callbacks, fragments, traversal or absolute file")).toEqual([]);
    expect(securityHits("Restore agent endpoint security wording")).toEqual([]);
    expect(securityHits("a session ends when its sandbox is gone")).toEqual([]);
  });

  it("parses numstat, messages, and merge-tree conflicts", () => {
    expect(expandNumstatPath("src/{old => new}/file.ts")).toEqual(["src/old/file.ts", "src/new/file.ts"]);
    const commits = parseNumstatLog("\x1eaaa\x1f2026-11-26T00:00:00Z\x1fsubject\n1\t0\tREADME.md\n");
    expect(commits).toEqual([{ sha: "aaa", date: "2026-11-26T00:00:00Z", subject: "subject", files: ["README.md"] }]);
    const messages = parseMessageLog("\x1ebbb\x1f2026-11-26T00:00:00Z\x1ffix\x1fbody CVE-2026-1\n");
    expect(messages[0].body).toContain("CVE-2026-1");
    const conflicts = parseConflicts(
      [
        "CONFLICT (content): Merge conflict in README.md",
        "CONFLICT (modify/delete): .github/workflows/package-win.yml deleted in HEAD and modified in upstream/main.  Version upstream/main of .github/workflows/package-win.yml left in tree.",
      ].join("\n"),
    );
    expect(conflicts.map((conflict) => [conflict.kind, conflict.path])).toEqual([
      ["content", "README.md"],
      ["modify/delete", ".github/workflows/package-win.yml"],
    ]);
  });
});

describe("the report decision", () => {
  const base = {
    measuredAt: "2026-11-26T00:00:00.000Z",
    fork: { sha: "a".repeat(40), date: "2026-11-20T21:40:14Z", subject: "fork" },
    ours: { sha: "b".repeat(40), date: "2026-11-25T00:00:00Z", subject: "edu" },
    upstream: { sha: "c".repeat(40), date: "2026-11-26T00:00:00Z", subject: "up" },
    ahead: 2,
    behind: 3,
    cumulativeFiles: ["server/index.ts", "README.md"],
    messages: [
      { sha: "c".repeat(40), date: "2026-11-26T00:00:00Z", subject: "fix CVE-2026-9999", body: "" },
      { sha: "d".repeat(40), date: "2026-11-26T00:00:00Z", subject: "sandbox session", body: "unprivileged" },
    ],
    advisories: { ok: true, skipped: false, items: [] },
  };

  it("opens a draft only when the merge is clean and upstream is ahead", () => {
    const clean = assembleReport({
      ...base,
      firstParent: [{ sha: "c".repeat(40), date: "2026-11-26T00:00:00Z", subject: "readme and server", files: ["README.md", "server/index.ts"] }],
      conflictRecords: [],
    });
    expect(decide(clean)).toBe("draft-pr");
    expect(clean.security.map((commit) => commit.rules)).toEqual([["cve"]]);
    expect(clean.eduTouched.map((item) => item.file)).toEqual(["README.md"]);
    expect(clean.areas.map((area) => area.name)).toEqual(["server", "other"]);
    const markdown = renderReport(clean);
    expect(markdown).toContain("draft");
    expect(markdown).toContain("does not push to `main`");
    expect(markdown).toContain("milind-soni/OpenMausBot");
    const conflicted = assembleReport({
      ...base,
      firstParent: [],
      conflictRecords: [{ kind: "content", path: "README.md", line: "CONFLICT (content): Merge conflict in README.md" }],
    });
    expect(conflicted.decision).toBe("issue");
    expect(conflicted.conflicts[0].edu?.kind).toBe("identity");
    expect(decide({ ...clean, behind: 0, clean: true })).toBe("current");
  });
});

describe("publish guards", () => {
  it("refuses the upstream repository, other remotes, credentialed URLs, and any ref but upstream-sync", () => {
    expect(() => assertForkRepo(UPSTREAM_REPO)).toThrow(/upstream/);
    expect(() => assertForkRepo("someone/OpenMausBot")).toThrow(/upstream/);
    expect(() => assertForkRepo("EduardoMoraga/other")).toThrow(/outside/);
    expect(() => assertForkRepo(FORK_REPO)).not.toThrow();
    expect(() => assertUpstreamUrl("https://user:token@github.com/milind-soni/OpenMausBot.git", {})).toThrow(/credentials/);
    expect(() => assertUpstreamUrl("https://github.com/EduardoMoraga/edu-bot.git", {})).toThrow(/not milind-soni/);
    expect(() => assertUpstreamUrl("https://github.com/milind-soni/OpenMausBot.git", {})).not.toThrow();
    expect(() => assertUpstreamUrl("file:///tmp/upstream", {})).toThrow(/not milind-soni/);
    expect(() => assertUpstreamUrl("file:///tmp/upstream", { UPSTREAM_SYNC_ALLOW_FILE_URL: "1" })).not.toThrow();
    expect(pushArgs(null)).toEqual(["push", "origin", "HEAD:refs/heads/upstream-sync"]);
    expect(pushArgs("a".repeat(40))[1]).toBe(`--force-with-lease=refs/heads/upstream-sync:${"a".repeat(40)}`);
    expect(() => pushArgs("refs/heads/main")).toThrow(/lease/);
    expect(pushArgs(null).join(" ")).not.toContain("main");
    expect(pushArgs("b".repeat(40)).join(" ")).not.toContain(UPSTREAM_REPO);
  });

  it("does not call gh or git when the repository is upstream", async () => {
    await expect(publish(tmpdir(), { GITHUB_REPOSITORY: UPSTREAM_REPO, GITHUB_ACTIONS: "true" })).rejects.toThrow(/upstream/);
    await expect(publish(tmpdir(), { GITHUB_REPOSITORY: FORK_REPO })).rejects.toThrow(/outside GitHub Actions/);
  });
});

// The publish job runs on ubuntu-24.04; Windows cannot exec the extensionless node-shebang gh double.
describe.skipIf(process.platform === "win32")("a local publish", () => {
  it("opens an issue and does not push when the merge conflicts", () => {
    const fx = fixture(true);
    const upstreamBefore = git(fx.upstream, ["rev-parse", "HEAD"]);
    const mainBefore = git(fx.origin, ["rev-parse", "refs/heads/main"]);
    const result = spawnSync(process.execPath, [script, "publish"], { cwd: fx.fork, encoding: "utf8", env: publishEnv(fx) });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("conflicts");
    expect(git(fx.upstream, ["rev-parse", "HEAD"])).toBe(upstreamBefore);
    expect(git(fx.origin, ["rev-parse", "refs/heads/main"])).toBe(mainBefore);
    expect(git(fx.origin, ["show-ref"])).not.toContain("upstream-sync");
    const calls = ghCalls(fx).map((args) => args.slice(0, 2).join(" "));
    expect(calls).toContain("issue create");
    expect(calls).not.toContain("pr create");
    expect(calls).not.toContain("pr merge");
    expect(git(fx.fork, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
    expect(git(fx.fork, ["status", "--porcelain"])).toBe("");
  });

  it("pushes only upstream-sync and opens a draft pull request when the merge is clean", () => {
    const fx = fixture(false);
    const mainBefore = git(fx.origin, ["rev-parse", "refs/heads/main"]);
    const upstreamBefore = git(fx.upstream, ["rev-parse", "HEAD"]);
    const result = spawnSync(process.execPath, [script, "publish"], { cwd: fx.fork, encoding: "utf8", env: publishEnv(fx) });
    expect(result.status, result.stderr).toBe(0);
    expect(git(fx.origin, ["rev-parse", "refs/heads/main"])).toBe(mainBefore);
    expect(git(fx.upstream, ["rev-parse", "HEAD"])).toBe(upstreamBefore);
    expect(git(fx.origin, ["rev-parse", "refs/heads/upstream-sync^1"])).toBe(mainBefore);
    expect(git(fx.origin, ["log", "-1", "--format=%B", "refs/heads/upstream-sync"])).toContain("Do not merge");
    const calls = ghCalls(fx);
    const create = calls.find((args) => args[0] === "pr" && args[1] === "create");
    expect(create).toContain("--draft");
    expect(create).toContain("--base");
    expect(calls.some((args) => args[0] === "pr" && args[1] === "merge")).toBe(false);
    expect(calls.some((args) => args.includes("milind-soni/OpenMausBot"))).toBe(false);
    expect(git(fx.fork, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
  });

  it("stops without a pull request when GitHub Issues are disabled", () => {
    const fx = fixture(true);
    const result = spawnSync(process.execPath, [script, "publish"], {
      cwd: fx.fork,
      encoding: "utf8",
      env: { ...publishEnv(fx), GH_DISABLE_ISSUES: "1" },
    });
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("Enable them under Settings");
    expect(result.stderr).toContain("No pull request was opened");
    expect(git(fx.origin, ["show-ref"])).not.toContain("upstream-sync");
    expect(ghCalls(fx).some((args) => args[0] === "pr" && args[1] === "create")).toBe(false);
  });

  it("dry-run prints the decision and does not push or call gh", () => {
    const fx = fixture(true);
    const result = spawnSync(process.execPath, [script, "publish"], {
      cwd: fx.fork,
      encoding: "utf8",
      env: { ...publishEnv(fx), UPSTREAM_SYNC_DRY_RUN: "1", UPSTREAM_SYNC_PUBLISH: "0" },
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("dry-run decision: issue");
    expect(git(fx.origin, ["show-ref"])).not.toContain("upstream-sync");
    expect(existsSync(fx.ghLog) ? readFileSync(fx.ghLog, "utf8") : "").toBe("");
  });
});

describe("the workflow", () => {
  it("is a weekly pinned job that can write only on this fork", () => {
    const text = readFileSync(workflowPath, "utf8");
    const workflow = parse(text) as {
      on: { schedule: { cron: string }[]; workflow_dispatch?: unknown; pull_request?: unknown; push?: unknown };
      jobs: { report: { if: string; permissions: { contents: string; "pull-requests": string; issues: string }; steps: { uses?: string; run?: string; with?: { ref?: string } }[] } };
    };
    expect(workflow.on.schedule).toEqual([{ cron: "23 14 * * 1" }]);
    expect(workflow.on.schedule[0].cron.split(" ")[4]).toBe("1");
    expect(workflow.on.pull_request).toBeUndefined();
    expect(workflow.on.push).toBeUndefined();
    expect(workflow.jobs.report.if).toBe("github.repository == 'EduardoMoraga/edu-bot'");
    expect(workflow.jobs.report.permissions).toEqual({ contents: "write", "pull-requests": "write", issues: "write" });
    const uses = [...text.matchAll(/uses: (\S+)/g)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const pin of uses) expect(pin).toMatch(/@[0-9a-f]{40}$/);
    expect(text).not.toContain("pull_request_target");
    expect(text).not.toContain("gh pr merge");
    expect(text).toContain("ref: main");
    expect(text).toContain("node scripts/upstream-sync.mjs publish");
    const checkout = workflow.jobs.report.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with?.ref).toBe("main");
  });

  it("documents every Edu-owned path", () => {
    const doc = readFileSync(docPath, "utf8");
    for (const rule of EDU_OWNED) expect(doc, rule.path).toContain(`\`${rule.path}\``);
    expect(doc).toContain("upstream-sync");
    expect(doc).toContain("milind-soni/OpenMausBot");
    expect(doc).not.toContain("gh pr merge");
  });
});
