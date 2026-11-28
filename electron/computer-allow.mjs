// Always allow: one of the person's own computers on Tailscale may use this one. This computer signs in to that computer's
// Edu Bot by Tailscale alone, which that server grants only to the same Tailscale owner, and lends it only the folder the
// person picks now. Security: never the terminal or the screen, and nothing before a folder is chosen.

const SIGN_IN_PATH = "/api/auth/tailnet";
const SIGN_IN_MS = 15_000;

/**
 * `list()` is My computers' list (tailnet-computers.mjs): a row is allowed only from what this computer found itself, never
 * from an address a page sends; a row's id is its Tailscale name. `environments` finds a saved server by host name and saves
 * one by origin, without switching the window to it;
 * `sharing` is computer-sharing.mjs; `chooseFolder(name)` asks for the one folder, null when the person cancels.
 */
export function createComputerAllow({ list, fetch: fetchImpl, label, platform, environments, sharing, chooseFolder, t, log = () => {} }) {
  const lending = (env) => {
    if (!env) return null;
    const state = sharing.state(env.id);
    return state?.enabled === true ? { folders: (state.folders ?? []).map((folder) => folder.name).filter(Boolean) } : null;
  };

  async function found(id) {
    const { computers = [] } = await list();
    const computer = computers.find((entry) => entry.id === id);
    if (!computer || computer.status !== "eduBot" || !computer.address) throw new Error(t("native.computers.notThere"));
    if (!computer.trust) throw new Error(t("native.computers.update", { name: computer.name }));
    return computer;
  }

  async function signIn(computer) {
    let response;
    try {
      response = await fetchImpl(`${computer.address}${SIGN_IN_PATH}`, { method: "POST", credentials: "include", redirect: "error", cache: "no-store",
        headers: { "content-type": "application/json", origin: computer.address }, body: JSON.stringify({ label, platform, cookie: true }),
        signal: AbortSignal.timeout(SIGN_IN_MS) });
    } catch {
      throw new Error(t("native.computers.unreachable", { name: computer.name }));
    }
    await response.body?.cancel?.().catch(() => {});
    if (!response.ok) {
      log(`computers: ${computer.name} refused Tailscale sign-in (${response.status})`);
      throw new Error(t("native.computers.refused", { name: computer.name }));
    }
  }

  const api = {
    /** Each row as the list shows it, with `allowed` and the folders it uses here while this computer lends to it. */
    async rows() {
      const answer = await list();
      const computers = (answer.computers ?? []).map((computer) => {
        const lent = lending(environments.byHost(computer.id));
        return lent ? { ...computer, allowed: true, folders: lent.folders } : { ...computer, allowed: false };
      });
      return { ...answer, computers };
    },
    /** Resolves true once it lends, false when the person picked no folder. */
    async allow(id) {
      const computer = await found(id);
      const folder = await chooseFolder(computer.name);
      if (!folder) return false;
      await signIn(computer);
      const env = environments.save({ origin: computer.address, name: computer.name });
      await sharing.lendOwn(env, { folders: [folder], terminal: false, computer: false });
      return true;
    },
    /** Stops lending to it, online or not. */
    async stop(id) {
      const env = environments.byHost(id);
      if (env) await sharing.revoke(env);
    },
    /** Only the desktop window's own page asks (`localOnly`). */
    install(ipcMain, localOnly) {
      ipcMain.handle("companion:computers", localOnly("companion:computers", () => api.rows()));
      ipcMain.handle("companion:computer-allow", localOnly("companion:computer-allow", (_event, id) => api.allow(String(id ?? ""))));
      ipcMain.handle("companion:computer-stop", localOnly("companion:computer-stop", (_event, id) => api.stop(String(id ?? ""))));
    },
  };
  return api;
}
