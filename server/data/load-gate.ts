import { ConnectionStore } from "./connections.ts";
import type { NamedDataAccess } from "./live.ts";
import { DataFailure } from "./types.ts";

const FOLDER = "Allow the folder that contains this file first.";

/** A sqlite or duckdb load stays inside an allowed folder, and inside the bot's grant when the file is a named connection. */
export function assertDatabaseLoad(named: NamedDataAccess | undefined, file: string, table: string | undefined): void {
  if (!named) throw new DataFailure({ code: "invalid_input", message: FOLDER });
  const store = new ConnectionStore(named.dataDir, {
    secret: (id) => {
      const value = named.secret(id);
      return value === null ? null : { value };
    },
  });
  let real: string;
  try {
    real = store.allowedFile(file);
  } catch (error) {
    const message = error instanceof Error ? error.message : FOLDER;
    throw new DataFailure({ code: "invalid_input", message });
  }
  const match = store.connectionAt(real);
  if (!match) return;
  const grant = named.allowlist()?.[match.name];
  if (!grant) throw new DataFailure({ code: "write_refused", message: `This bot may not use ${match.name}.` });
  if (!grant.tables?.length) return;
  const wanted = (table ?? "").toLowerCase();
  const listed = grant.tables.some((item) => item.toLowerCase().split(".").filter(Boolean).at(-1) === wanted);
  if (!wanted || !listed) throw new DataFailure({ code: "write_refused", message: `This bot may not read ${table || "every table"} on ${match.name}.` });
}
