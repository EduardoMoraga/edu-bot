import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { removeTempDir } from "../testing/cleanup.ts";
import { gitCommitOf } from "./git-commit.ts";

const scratch = mkdtempSync(join(tmpdir(), "omb-git-commit-"));
afterAll(() => removeTempDir(scratch));
const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);
const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
let n = 0;
const repo = () => join(scratch, `repo-${++n}`);

describe("gitCommitOf", () => {
  it("reads the branch's commit from a folder inside the checkout", () => {
    const root = repo();
    write(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    write(join(root, ".git", "refs", "heads", "main"), `${SHA}\n`);
    mkdirSync(join(root, "edubot", "areas"), { recursive: true });
    expect(gitCommitOf(join(root, "edubot"))).toBe(SHA);
  });

  it("reads packed refs and a detached HEAD", () => {
    const packed = repo();
    write(join(packed, ".git", "HEAD"), "ref: refs/heads/main\n");
    write(join(packed, ".git", "packed-refs"), `# pack-refs with: peeled fully-peeled sorted\n${OTHER} refs/heads/dev\n${SHA} refs/heads/main\n`);
    expect(gitCommitOf(packed)).toBe(SHA);
    const detached = repo();
    write(join(detached, ".git", "HEAD"), `${OTHER}\n`);
    expect(gitCommitOf(detached)).toBe(OTHER);
  });

  it("follows a worktree's .git file to its own HEAD and the shared refs", () => {
    const main = repo();
    write(join(main, ".git", "refs", "heads", "feature"), `${OTHER}\n`);
    const gitDir = join(main, ".git", "worktrees", "wt");
    write(join(gitDir, "HEAD"), "ref: refs/heads/feature\n");
    write(join(gitDir, "commondir"), "../..\n");
    const worktree = repo();
    write(join(worktree, ".git"), `gitdir: ${gitDir}\n`);
    expect(gitCommitOf(worktree)).toBe(OTHER);
  });

  it("is undefined outside a checkout and for a ref that climbs out of the git folder", () => {
    const plain = repo();
    mkdirSync(plain, { recursive: true });
    expect(gitCommitOf(plain)).toBeUndefined();
    const climbing = repo();
    write(join(climbing, ".git", "HEAD"), "ref: refs/../../secret\n");
    expect(gitCommitOf(climbing)).toBeUndefined();
  });
});
