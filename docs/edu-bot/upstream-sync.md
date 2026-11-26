# Upstream sync

Edu Bot se separó de OpenMausBot el 21 de noviembre de 2026. No vamos a traer todos sus cambios.
Cada lunes un aviso mide la distancia. Si entran sin choque, abre un borrador. Si chocan, abre un issue.
Nadie fusiona solo. Nunca escribe en el repo de OpenMausBot.

## What this is

[EduardoMoraga/edu-bot](https://github.com/EduardoMoraga/edu-bot) is a fork of [milind-soni/OpenMausBot](https://github.com/milind-soni/OpenMausBot). GitHub created the fork at 2026-11-21 02:40 UTC. The last commit both histories share is `b13b13a923c3` (2026-11-20 21:40 UTC), "Docs: correct stale and wrong statements in the self-hosting pages (#6798)". There is no plan to merge upstream into `main` on a schedule.

[`.github/workflows/upstream-sync.yml`](../../.github/workflows/upstream-sync.yml) runs every Monday at 14:23 UTC, and when someone starts it by hand. It fetches upstream `main` with an anonymous URL, writes a report, and leaves exactly one open artifact on **this** repository:

- a **draft** pull request from branch `upstream-sync` into `main`, when `git merge` of upstream `main` into Edu `main` is clean;
- otherwise one issue labeled `upstream-sync`, found again by the text `upstream-sync-report`.

The branch `upstream-sync` belongs to that workflow. Do not commit hand fixes on it. A later run replaces the branch with a fresh merge from current `main`. Port a fix on a normal branch instead.

## What it never does

- It does not merge the pull request.
- It does not push to `main`.
- It does not open a pull request, an issue, or a push on `milind-soni/OpenMausBot`.
- It does not run from any other repository. The job is skipped unless `github.repository` is `EduardoMoraga/edu-bot`, and the script refuses any other target, including a repo whose name ends in `OpenMausBot`.
- It pushes only `HEAD:refs/heads/upstream-sync` to `origin`. A second push uses `--force-with-lease` on that same ref.
- The upstream fetch drops global git config, so a machine that rewrites `https://github.com/` to a credentialed URL cannot attach that token to the upstream read.

GitHub leaves Issues off on a new fork. The conflict path needs Issues turned on for `EduardoMoraga/edu-bot` (Settings → General → Features → Issues). Until that box is on, the Monday run still writes the report into the Actions log and then stops, because it will not invent a pull request for a merge that conflicts.

`node scripts/upstream-sync.mjs report` only prints the report. `publish` runs in GitHub Actions. A local `publish` exits without calling `gh` unless `UPSTREAM_SYNC_PUBLISH=1` is set on purpose.

## Recommendation

Diverge. Keep the weekly report. Do not merge `upstream-sync` into `main`.

On 2026-11-26 02:21 UTC, Edu `main` (`f06df63b7c37`) was **68 commits ahead** and **1337 commits behind** upstream `main` (`3abd8bcb8f57`). 183 of those are the commits that landed on upstream main over about five days; the other 1154 came in through those merges. A trial merge conflicted in **174 paths** (10 of them Edu-owned, 164 shared). 85 upstream-main commits touch an Edu-owned path; 13 of those paths differ in the net diff. No public security advisory was published after the fork point, and no new commit matched the report's security-fix markers.

Net diff by area, and how many of the 183 upstream-main commits land primarily there:

| Area | Files | Commits |
| --- | --- | --- |
| server | 1213 | 110 |
| src | 778 | 57 |
| electron | 117 | 0 |
| docs | 101 | 0 |
| other | 67 | 8 |
| shared | 62 | 3 |
| packages | 55 | 2 |
| scripts | 39 | 3 |
| github | 4 | 0 |

Electron, docs, and workflow files did change, but those edits rode along inside commits whose largest change was another area, so their commit count is 0.

Upstream `main` moves by hundreds of commits a week, and Edu has its own product on the same tree: identity, profiles, the Edu brain, SQL connections, its own release workflows, and the analytics and enterprise code it removed. A standing merge will keep conflicting. Read the report. If a security fix is worth having, port that change by hand on a normal branch and review it. Leave the rest upstream.

The live numbers are the weekly issue or draft. This paragraph is the baseline, not a feed.

## How a run decides

1. Fetch `https://github.com/milind-soni/OpenMausBot.git` `main` into `refs/remotes/upstream/main`. No remote named `upstream` is stored, and the fetch URL is not allowed to carry a token.
2. Compare `origin/main` with that tip. The count behind is every commit reachable from upstream that Edu does not have. The report groups the first-parent commits, because those are the ones that landed on upstream `main`.
3. `git merge-tree` tries the merge without touching the worktree. Security markers are read from every commit message in the range. Edu-owned paths are the list below.
4. If the merge is clean and upstream is ahead, check out `upstream-sync` at `origin/main`, merge with `--no-ff`, and push only that branch. The pull request is created or updated as a draft. An open report issue is closed with a comment. Closing it does not merge.
5. If the merge conflicts, nothing is pushed. The issue is opened or updated. An open **draft** pull request for `upstream-sync` is closed with a comment, again without a merge. A pull request a person has already marked ready is left open and only commented on.
6. If Edu `main` already contains upstream `main`, the run closes the open report artifacts and pushes nothing.

A security-fix marker is a CVE id, a GHSA id, the word vulnerability, "security fix" (or patch, advisory, issue, hole, update), XSS, CSRF, SSRF, remote code execution, path traversal, authentication bypass, privilege escalation, a credential leak, a sandbox escape, or SQL, command, header, or prompt injection. Ordinary "sandbox" features and the word "security" in copy do not count. The report also reads public GitHub security advisories for `milind-soni/OpenMausBot` published after the fork point. If that request fails, the report says it could not check, which is not a claim that none exist.

Areas are `server`, `src`, `electron`, `shared`, `packages`, `scripts`, `docs` (including `apps/docs`), `github`, `apps`, and `other`. A commit is counted in the area where most of its files sit.

## Edu-owned paths

These are the paths the report flags. They are `EDU_OWNED` in [`scripts/upstream-sync.mjs`](../../scripts/upstream-sync.mjs). A git conflict on any other file is still listed, under "Other", because Edu has also patched shared files such as `electron/main.mjs` and `server/index.ts`. Those shared files are not in this list: upstream owns their features, and Edu's edits there are branding or behavior on top.

A prefix such as `server/edu-` matches `server/edu-brain.ts` and does not match `server/education.ts`. A directory matches that directory and everything under it.

### Identity

Edu rewrote these. Upstream still edits several of them.

- `README.md` — English readme, rewritten for Edu Bot
- `README.es.md` — Spanish readme; this file is Edu's
- `DESIGN.md` — Edu design rules
- `NOTICE` — Attribution text Edu edited
- `LICENSING.md` — Fork attribution
- `package.json` — Product name, version, and scripts
- `electron-builder.yml` — App id, install paths, and the publish repository
- `electron/app-identity.mjs` — Runtime product identity
- `electron/app-identity.d.mts` — Runtime product identity types
- `electron/desktop-updates.mjs` — Updates come from this repository
- `electron/desktop-updates.test.mjs` — Update-source tests
- `build/linux-edubot-browser.apparmor` — Renamed AppArmor profile

### Edu docs

- `docs/edu-bot` — Edu planning and operator notes, including this file
- `docs/edu-brain.md` — Edu brain docs
- `docs/profiles.md` — Profile docs
- `docs/verification/antigravity-live.md` — Edu verification note
- `docs/verification/composio-own-key.md` — Edu verification note
- `docs/verification/data-connections.md` — Edu verification note

### Edu product

- `server/edu-` — Edu brain, crew, and proposals
- `server/profiles` — Organization profiles

Upstream already had its chart engine in `server/data/` (`engine.ts`, `types.ts`, and the files that were there at the fork). Only these connection files are Edu's:

- `server/data/connection-routes.ts` — Edu SQL connections
- `server/data/connections.test.ts` — Edu SQL connections
- `server/data/connections.ts` — Edu SQL connections
- `server/data/data-connections.e2e.test.ts` — Edu SQL connections
- `server/data/duckdb-extensions.json` — Edu SQL connections
- `server/data/extensions.ts` — Edu SQL connections
- `server/data/grants.ts` — Edu SQL connections
- `server/data/internal-mcp.ts` — Edu SQL connections
- `server/data/live.ts` — Edu SQL connections
- `server/data/local-files.test.ts` — Edu SQL connections
- `server/data/local-files.ts` — Edu SQL connections
- `server/data/named-read.test.ts` — Edu SQL connections
- `server/data/session.ts` — Edu SQL connections
- `server/data/sql-escape.test.ts` — Edu SQL connections
- `server/data/sql-shape.test.ts` — Edu SQL connections
- `server/data/sql-shape.ts` — Edu SQL connections
- `server/routes/edu.ts` — Edu routes
- `server/routes/profiles.ts` — Profile routes
- `server/routes/profiles.test.ts` — Profile route tests
- `server/headless/profiles.ts` — Headless profile commands
- `server/headless/profiles.test.ts` — Headless profile tests
- `server/host/edu-host.ts` — Edu host wiring
- `server/desired-bot.ts` — Profile bot shape
- `server/composio-own-` — Composio with the user's own key
- `server/composio-live.e2e.test.ts` — Own-key Composio test
- `server/antigravity-live.e2e.test.ts` — Antigravity live test
- `shared/edu-` — Shared Edu types
- `shared/profile-` — Shared profile types
- `shared/data-connections.ts` — Shared SQL connection types
- `packages/phone-protocol/src/edu-brain.ts` — Phone protocol Edu brain types
- `packages/phone-protocol/src/data-connections.ts` — Phone protocol SQL types
- `packages/phone-protocol/src/thread-order.ts` — Thread order types
- `skills/edu-crew` — Edu crew skill
- `src/components/Edu` — Edu chat and mascot UI
- `src/components/profiles` — Profile UI
- `src/components/AppsKeySetup.tsx` — Own Composio key setup
- `src/components/ThemeEditor.tsx` — Edu theme editor
- `src/components/bot-panel/EduBrainCard.tsx` — Edu brain card
- `src/components/bot-panel/EduBrainCard.dom.test.ts` — Edu brain card test
- `src/components/bot-settings/DataSection.tsx` — Per-bot data access
- `src/components/bot-settings/BotAccessSummary.tsx` — Bot access summary
- `src/components/bot-settings/BotAccessSummary.dom.test.ts` — Bot access summary test
- `src/components/settings/DataConnectionsSection.tsx` — SQL connection settings
- `src/components/settings/pages/ProfilesPage.tsx` — Profiles settings page
- `src/lib/edu-` — Edu client helpers
- `src/lib/profile-plan-view.ts` — Profile plan view
- `src/lib/server-labels.ts` — Edu Bot server labels
- `src/lib/engine-reason.ts` — Engine reason copy
- `src/lib/email-gate.ts` — Email gate copy
- `server/vault/mcp-header-keys.ts` — MCP header key storage

### Removed on purpose

An upstream edit of one of these is a modify/delete conflict. Putting the file back would undo an Edu decision (no enterprise tree, no analytics, no upstream release workflows).

- `enterprise` — Edu removed the enterprise tree from the open-source app
- `.github/CODEOWNERS` — Edu removed upstream code owners
- `.github/workflows/browser-vendor-windows.yml` — Edu removed this upstream workflow
- `.github/workflows/connector-e2e.yml` — Edu removed this upstream workflow
- `.github/workflows/connector-release.yml` — Edu removed this upstream workflow
- `.github/workflows/contributors.yml` — Edu removed this upstream workflow
- `.github/workflows/docker.yml` — Edu removed this upstream workflow
- `.github/workflows/npm-package.yml` — Edu removed this upstream workflow
- `.github/workflows/package-linux.yml` — Edu removed this upstream workflow
- `.github/workflows/package-win.yml` — Edu removed this upstream workflow
- `.github/workflows/podman-service.yml` — Edu removed this upstream workflow
- `.github/workflows/prepare-release.yml` — Edu removed this upstream workflow
- `.github/workflows/promote-stable.yml` — Edu removed this upstream workflow
- `.github/workflows/server-installer.yml` — Edu removed this upstream workflow
- `.github/workflows/server-update-e2e.yml` — Edu removed this upstream workflow
- `.github/workflows/sync-published-release.yml` — Edu removed this upstream workflow
- `.github/workflows/windows-defender-check.yml` — Edu removed this upstream workflow
- `docs/analytics.md` — Edu removed analytics and phone-home
- `apps/docs/content/docs/security/analytics.mdx` — Edu removed analytics and phone-home
- `electron/launch-analytics.mjs` — Edu removed analytics and phone-home
- `electron/launch-analytics.node-test.mjs` — Edu removed analytics and phone-home
- `src/lib/analytics.ts` — Edu removed analytics and phone-home
- `src/lib/analytics.test.ts` — Edu removed analytics and phone-home
- `src/lib/analytics.wire.test.ts` — Edu removed analytics and phone-home
- `src/lib/analytics-allowlist.ts` — Edu removed analytics and phone-home
- `src/lib/analytics-allowlist.test.ts` — Edu removed analytics and phone-home
- `src/lib/product-events.ts` — Edu removed analytics and phone-home
- `src/lib/product-events.test.ts` — Edu removed analytics and phone-home
- `src/components/AnalyticsRow.tsx` — Edu removed analytics and phone-home
- `src/hooks/use-usage-snapshot.ts` — Edu removed analytics and phone-home
- `src/hooks/use-usage-snapshot.test.ts` — Edu removed analytics and phone-home
- `src/lib/usage-snapshot.ts` — Edu removed analytics and phone-home
- `src/lib/usage-snapshot.test.ts` — Edu removed analytics and phone-home

### Release and this report

- `.github/workflows/release.yml` — Edu release workflow
- `.github/workflows/ci.yml` — Edu CI workflow
- `.github/workflows/ci-stop-closed.yml` — Edu CI cleanup workflow
- `.github/workflows/docs.yml` — Edu docs workflow
- `.github/workflows/dev-desktop-setup.yml` — Edu desktop setup workflow
- `.github/workflows/shared-terminal-smoke.yml` — Edu smoke workflow
- `.github/workflows/upstream-sync.yml` — This report workflow
- `scripts/upstream-sync.mjs` — This report script
- `scripts/upstream-sync.test.ts` — This report's tests
- `scripts/release-ci.mjs` — Edu release helper
- `scripts/edu-release.test.ts` — Edu release tests
- `scripts/strip-linux-rpm-feed.mjs` — Edu package feed strip
- `scripts/dev-desktop-setup.mjs` — Edu desktop setup helper

### Copy Edu keeps complete

English and Spanish are maintained here. Other locale files stay with upstream and are not in this list.

- `src/locales/en.json` — English copy Edu keeps complete
- `src/locales/es.json` — Spanish copy Edu keeps complete

## Reading a report

The report starts with the two counts (behind and ahead), the fork commit, and whether this run opened a draft or an issue. Then:

- **Security fixes.** Every matching commit, including ones that landed only inside a merged branch. Treat a hit as a lead, and read the commit before porting it.
- **Edu-owned paths upstream changed.** Upstream commits that edit the list above. A clean auto-merge can still overwrite Edu behavior, so these are listed even when git reports no conflict.
- **By area.** Where upstream main spent its commits.
- **Git conflicts.** Edu-owned paths first, then the shared paths.

## Porting one fix

1. Read the weekly report and open the upstream commit.
2. Branch from current Edu `main`. Do not use `upstream-sync`.
3. Cherry-pick or retype that change. Keep Edu's names, data directory, update URL, and the removed analytics and enterprise code.
4. Open a normal pull request into `main` and review it. The weekly draft, if one exists, stays a draft.
