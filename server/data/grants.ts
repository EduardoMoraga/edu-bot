import type { DataGrantMap } from "../../shared/data-connections.ts";
import { ConnectionStore, type ConnectionVault } from "./connections.ts";

type GrantVault = Pick<ConnectionVault, "secret"> & { updateSecret?(id: string, patch: { bots: string[] }): unknown };

/** Connection secrets stay on the server. Allowlists live on the bot, so the Vault grant is always empty. */
export function syncConnectionGrants(
  vault: GrantVault,
  dataDir: string,
  _bots: ReadonlyArray<{ id: string; dataConnections?: DataGrantMap }>,
): void {
  if (!vault.updateSecret) return;
  const store = new ConnectionStore(dataDir, vault);
  for (const connection of store.vaultConnections()) vault.updateSecret(connection.id, { bots: [] });
}
