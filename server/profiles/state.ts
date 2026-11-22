import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";

const hashes = z.record(z.string(), z.string());
const stateSchema = z.object({
  version: z.literal(1),
  folder: z.string().optional(),
  applied: z.object({ at: z.number(), commit: z.string().optional(), digest: z.string(), folder: z.string() }).optional(),
  areas: z.record(z.string(), z.object({ section: z.string(), hashes })).default({}),
});

/** `<data>/profiles.json`: the folder the person chose, what was last applied, and each applied area's department. */
export type ProfilesState = z.infer<typeof stateSchema>;

export const profilesStateFile = (dataDir: string) => join(dataDir, "profiles.json");

export function readProfilesState(dataDir: string): ProfilesState {
  let raw: string;
  try {
    raw = readFileSync(profilesStateFile(dataDir), "utf8");
  } catch {
    return { version: 1, areas: {} };
  }
  try {
    const parsed = stateSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch { /* falls through to the empty state */ }
  console.warn("profiles.json could not be read; starting with no applied profiles");
  return { version: 1, areas: {} };
}

export function writeProfilesState(dataDir: string, state: ProfilesState): void {
  writeFileAtomic(profilesStateFile(dataDir), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}
