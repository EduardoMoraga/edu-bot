import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const SMALL = 64 * 1024;
const PACKED_REFS_MAX = 4 * 1024 * 1024;
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const REF = /^refs\/[\w./-]+$/;
const MAX_LEVELS = 64;

function readCapped(path: string, max: number): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > max) return null;
    const size = stat.size;
    const buffer = Buffer.alloc(size);
    let read = 0;
    while (read < size) {
      const n = readSync(fd, buffer, read, size - read, read);
      if (n === 0) break;
      read += n;
    }
    return buffer.subarray(0, read).toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const isDir = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** The git folder of the checkout holding `folder`: `.git` itself, or where a worktree's `.git` file points. */
function gitDirOf(folder: string): string | null {
  let dir = resolve(folder);
  for (let level = 0; level < MAX_LEVELS; level++) {
    const dotGit = join(dir, ".git");
    if (isDir(dotGit)) return dotGit;
    const pointer = readCapped(dotGit, SMALL)?.match(/^gitdir:\s*(.+?)\s*$/m)?.[1];
    if (pointer) {
      const target = isAbsolute(pointer) ? pointer : resolve(dir, pointer);
      return isDir(target) ? target : null;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function refIn(gitDir: string, commonDir: string, ref: string): string | null {
  for (const dir of gitDir === commonDir ? [gitDir] : [gitDir, commonDir]) {
    const loose = readCapped(join(dir, ...ref.split("/")), SMALL)?.trim();
    if (loose && SHA.test(loose)) return loose;
  }
  const packed = readCapped(join(commonDir, "packed-refs"), PACKED_REFS_MAX) ?? "";
  for (const line of packed.split("\n")) {
    const [sha, name] = line.trim().split(" ");
    if (name === ref && sha && SHA.test(sha)) return sha;
  }
  return null;
}

/** The commit checked out in the git repository holding `folder`, read from `.git` without running git; undefined
 * when the folder is not in a checkout or its HEAD cannot be read. */
export function gitCommitOf(folder: string): string | undefined {
  const gitDir = gitDirOf(folder);
  if (!gitDir) return undefined;
  const common = readCapped(join(gitDir, "commondir"), SMALL)?.trim();
  const commonDir = common ? (isAbsolute(common) ? common : resolve(gitDir, common)) : gitDir;
  const head = readCapped(join(gitDir, "HEAD"), SMALL)?.trim();
  if (!head) return undefined;
  if (SHA.test(head)) return head;
  const ref = head.match(/^ref:\s*(\S+)$/)?.[1];
  if (!ref || !REF.test(ref) || ref.split("/").includes("..")) return undefined;
  return refIn(gitDir, commonDir, ref) ?? undefined;
}
