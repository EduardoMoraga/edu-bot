/** What one bot may do with one named connection. Absent schemas or tables mean all of them. Absent write means never. */
export interface DataGrant {
  schemas?: string[];
  tables?: string[];
  write?: "never" | "ask";
}

/** Connection name to grant. Absent map: the bot may use no named database. */
export type DataGrantMap = Record<string, DataGrant>;
