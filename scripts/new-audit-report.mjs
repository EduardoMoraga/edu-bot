import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MILESTONE = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const REVIEWER = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const USAGE = "Usage: pnpm report:audit -- <milestone> <reviewer> [YYYY-MM-DD]";

const TEMPLATE = `# <milestone> audit — <reviewer> — YYYY-MM-DD

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
`;

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultReportsDirectory = path.join(repoRoot, "docs", "edu-bot", "reports");

export function utcDay(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function isUtcDate(value) {
  if (typeof value !== "string") return false;
  const match = DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export function auditReportFilename(milestone, reviewer, date) {
  if (typeof milestone !== "string" || milestone.length > 64 || !MILESTONE.test(milestone)) {
    throw new Error(`milestone must be a lowercase slug such as m7 or v0.3.0 (got ${JSON.stringify(milestone)})`);
  }
  if (typeof reviewer !== "string" || reviewer.length > 32 || !REVIEWER.test(reviewer)) {
    throw new Error(`reviewer must be a lowercase slug such as grok or agy (got ${JSON.stringify(reviewer)})`);
  }
  if (!isUtcDate(date)) {
    throw new Error(`date must be a real UTC day YYYY-MM-DD (got ${JSON.stringify(date)})`);
  }
  return `${date}-${milestone}-${reviewer}.md`;
}

export function auditReportBody({ milestone, reviewer, date }) {
  auditReportFilename(milestone, reviewer, date);
  return TEMPLATE
    .replaceAll("<milestone>", milestone)
    .replaceAll("<reviewer>", reviewer)
    .replaceAll("YYYY-MM-DD", date);
}

export function parseAuditReportArgs(argv, now = new Date()) {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  if (args.includes("-h") || args.includes("--help")) return { help: true };
  if (args.length < 2 || args.length > 3) throw new Error(USAGE);
  const [milestone, reviewer, date = utcDay(now)] = args;
  auditReportFilename(milestone, reviewer, date);
  return { milestone, reviewer, date };
}

export async function createAuditReport({
  reportsDir,
  milestone,
  reviewer,
  date,
  exists = existsSync,
  write = (file, text) => writeFile(file, text),
}) {
  const filename = auditReportFilename(milestone, reviewer, date);
  const file = path.join(reportsDir, filename);
  if (exists(file)) throw new Error(`already exists: ${filename}`);
  await write(file, auditReportBody({ milestone, reviewer, date }));
  return file;
}

export async function main({
  argv = process.argv.slice(2),
  reportsDir = defaultReportsDirectory,
  log = console.log,
  error = console.error,
  now = new Date(),
} = {}) {
  let parsed;
  try {
    parsed = parseAuditReportArgs(argv, now);
  } catch (caught) {
    error(caught instanceof Error ? caught.message : String(caught));
    return 1;
  }
  if (parsed.help) {
    log(USAGE);
    return 0;
  }
  try {
    const file = await createAuditReport({ reportsDir, ...parsed });
    log(path.relative(repoRoot, file));
    return 0;
  } catch (caught) {
    error(caught instanceof Error ? caught.message : String(caught));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
