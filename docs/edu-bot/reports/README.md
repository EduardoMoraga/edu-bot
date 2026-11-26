# Audit reports

Cross-vendor audits of a milestone are committed in this folder, inside the milestone pull request. One file per audit. This folder is the record. A copy under `~/Projects/edu-bot-wt/reports/` stays on one machine.

## Name

`YYYY-MM-DD-<milestone>-<reviewer>.md`

- `YYYY-MM-DD` is the UTC day the audit was written.
- `<milestone>` is a short lowercase slug: `m7`, `v0.3.0`, `pr-66`. Letters, digits, and single `.` or `-`.
- `<reviewer>` is the vendor that audited, not the one that wrote the change: `grok`, `agy`, `claude`, `codex`.
- A later round on another UTC day is a new file. A same-day re-audit updates this file and adds `### Round 2` (then 3, …) under Verdict and Findings.

Example: `2026-11-26-m7-grok.md`.

Create the file from the template:

```
pnpm report:audit -- m7 grok
pnpm report:audit -- v0.3.0 agy 2026-11-26
```

The command refuses to overwrite a file that is already there.

## What gets committed

Commit the report in the pull request the audit covers. `docs/edu-bot/PROGRESS.md` keeps the short Spanish status and links to this file. Leave screenshots, logs, and notes that only make sense on one machine out of git. Do not put secrets, tokens, or private data in the report.

## Template

Replace the placeholder sentences. Keep the five headings.

```markdown
# <milestone> audit — <reviewer> — YYYY-MM-DD

## Scope

What was reviewed (pull request, commit, behavior). What was left out.

## Verdict

PASS or FAIL. One sentence on why.

## Findings

Each finding: severity, where it is, what is wrong, what to change. none when the verdict is PASS.

## Follow-ups

Work that is real and does not block this milestone. none when there is nothing.

## Pull requests

- https://github.com/EduardoMoraga/edu-bot/pull/N
```
