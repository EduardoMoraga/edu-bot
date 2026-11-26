import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  auditReportBody,
  auditReportFilename,
  createAuditReport,
  main,
  parseAuditReportArgs,
  utcDay,
} from "./new-audit-report.mjs";

const readme = fileURLToPath(new URL("../docs/edu-bot/reports/README.md", import.meta.url));

describe("audit report scaffold", () => {
  it("names one file per UTC day, milestone, and reviewer", () => {
    expect(auditReportFilename("m7", "grok", "2026-11-26")).toBe("2026-11-26-m7-grok.md");
    expect(auditReportFilename("v0.3.0", "agy", "2026-11-26")).toBe("2026-11-26-v0.3.0-agy.md");
    expect(auditReportFilename("pr-66", "claude", "2026-11-26")).toBe("2026-11-26-pr-66-claude.md");
  });

  it("rejects slugs and dates that would leave the reports folder", () => {
    expect(() => auditReportFilename("../etc", "grok", "2026-11-26")).toThrow(/milestone/);
    expect(() => auditReportFilename("M7", "grok", "2026-11-26")).toThrow(/milestone/);
    expect(() => auditReportFilename("m7", "Grok", "2026-11-26")).toThrow(/reviewer/);
    expect(() => auditReportFilename("m7", "grok", "2026-02-31")).toThrow(/date/);
    expect(() => auditReportFilename("m7", "grok", "2026-11-26.md")).toThrow(/date/);
  });

  it("fills the README template", () => {
    const text = readFileSync(readme, "utf8");
    const fence = text.match(/```markdown\n([\s\S]*?)\n```/);
    expect(fence, "README keeps one markdown template").toBeTruthy();
    const expected = fence[1]
      .replaceAll("<milestone>", "m7")
      .replaceAll("<reviewer>", "grok")
      .replaceAll("YYYY-MM-DD", "2026-11-26");
    expect(auditReportBody({ milestone: "m7", reviewer: "grok", date: "2026-11-26" })).toBe(`${expected}\n`);
  });

  it("writes a new file and refuses to overwrite it", async () => {
    const reportsDir = mkdtempSync(path.join(tmpdir(), "audit-report-"));
    try {
      const file = await createAuditReport({
        reportsDir,
        milestone: "pr-66",
        reviewer: "claude",
        date: "2026-11-26",
      });
      expect(path.basename(file)).toBe("2026-11-26-pr-66-claude.md");
      expect(readFileSync(file, "utf8")).toContain("## Pull requests");
      await expect(createAuditReport({
        reportsDir,
        milestone: "pr-66",
        reviewer: "claude",
        date: "2026-11-26",
      })).rejects.toThrow(/already exists/);
    } finally {
      rmSync(reportsDir, { recursive: true, force: true });
    }
  });

  it("defaults the day to UTC and asks for the milestone and reviewer", async () => {
    const now = new Date("2026-11-26T23:30:00Z");
    expect(utcDay(now)).toBe("2026-11-26");
    expect(parseAuditReportArgs(["m7", "grok"], now)).toEqual({
      milestone: "m7",
      reviewer: "grok",
      date: "2026-11-26",
    });
    expect(parseAuditReportArgs(["--", "m7", "grok"], now).date).toBe("2026-11-26");
    expect(parseAuditReportArgs(["--help"])).toEqual({ help: true });
    expect(() => parseAuditReportArgs([])).toThrow(/Usage/);

    const lines = [];
    const reportsDir = mkdtempSync(path.join(tmpdir(), "audit-report-main-"));
    try {
      expect(await main({ argv: ["m0", "codex"], reportsDir, now, log: (line) => lines.push(line) })).toBe(0);
      expect(lines).toEqual([path.relative(fileURLToPath(new URL("..", import.meta.url)), path.join(reportsDir, "2026-11-26-m0-codex.md"))]);
      const errors = [];
      expect(await main({
        argv: ["m0", "codex"],
        reportsDir,
        now,
        error: (line) => errors.push(line),
      })).toBe(1);
      expect(errors[0]).toMatch(/already exists/);
    } finally {
      rmSync(reportsDir, { recursive: true, force: true });
    }
  });
});
