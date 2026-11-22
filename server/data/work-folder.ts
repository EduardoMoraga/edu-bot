import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { DataFailure } from "./types.ts";

const DATA_SENTENCE = "Edu Bot's data folder is not a place to load files from.";
const WORK_SENTENCE = "Load files from this bot's working folder.";

function inside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function real(path: string): string {
  return realpathSync(path);
}

/** A local load stays inside the bot's working folder. A link that resolves outside it is refused. */
export function assertWorkFolderLoad(source: string, workFolder: string, dataDir: string): void {
  let work: string;
  let data: string;
  try {
    work = real(workFolder);
    data = real(dataDir);
  } catch {
    throw new DataFailure({ code: "invalid_input", message: WORK_SENTENCE });
  }
  if (work === data || inside(work, data)) throw new DataFailure({ code: "invalid_input", message: DATA_SENTENCE });
  const target = resolve(source);
  let cursor = target;
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) throw new DataFailure({ code: "source_not_found", message: `${source} does not exist.` });
    cursor = parent;
  }
  let resolved: string;
  try { resolved = real(cursor); } catch {
    throw new DataFailure({ code: "invalid_input", message: WORK_SENTENCE });
  }
  const rest = relative(cursor, target);
  const full = rest ? resolve(resolved, rest) : resolved;
  if (!inside(work, resolved) || !inside(work, full)) throw new DataFailure({ code: "invalid_input", message: WORK_SENTENCE });
}
