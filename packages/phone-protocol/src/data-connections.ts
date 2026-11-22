/** What one bot may read on one named connection. Absent schemas or tables mean all of them. */
export interface DataGrant {
  schemas?: string[];
  tables?: string[];
}

/** Connection name to grant. Absent map: the bot may use no named database. */
export type DataGrantMap = Record<string, DataGrant>;
