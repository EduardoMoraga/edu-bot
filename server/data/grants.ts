import type { DataGrantMap } from "../../shared/data-connections.ts";
import { ConnectionStore, type ConnectionVault } from "./connections.ts";

type GrantVault = Pick<ConnectionVault, "secret"> & { updateSecret?(id: string, patch: { bots: string[] }): unknown };

/** A postgres secret is readable only by the bots whose grant names that connection. */
export function syncConnectionGrants(
  vault: GrantVault,
  dataDir: string,
  bots: ReadonlyArray<{ id: string; dataConnections?: DataGrantMap }>,
): void {
  if (!vault.updateSecret) return;
  const store = new ConnectionStore(dataDir, vault);
  for (const connection of store.vaultConnections()) {
    const allowed = bots.filter((bot) => bot.dataConnections && Object.hasOwn(bot.dataConnections, connection.name)).map((bot) => bot.id);
    vault.updateSecret(connection.id, { bots: allowed });
  }
}
