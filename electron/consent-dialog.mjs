// Security: a native question whose yes widens access, sends something out or removes something is asked here, so a
// dialog that never reached the person is never a yes. Electron 43 on a Linux session whose GTK dialog cannot open
// logs a Gtk error and resolves showMessageBox with response 0, as if the first button had been pressed.

/**
 * Asks with the refusing button first: it is index 0, the default and the cancel button, and only index 1 grants.
 * `parent`: the window the dialog belongs to, or null. A dialog that throws, or answers anything but 1, refuses.
 * @param {{ showMessageBox: Function }} dialog
 * @param {object | null | undefined} parent
 * @param {{ grant: string, refuse: string } & Record<string, unknown>} question `grant` and `refuse` are the two
 * button labels; the rest is showMessageBox's own (type, message, detail, noLink, signal).
 * @returns {Promise<"granted" | "refused">}
 */
export async function askConsent(dialog, parent, { grant, refuse, ...look }) {
  const options = { ...look, buttons: [refuse, grant], defaultId: 0, cancelId: 0 };
  try {
    const answer = await (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options));
    return answer?.response === 1 ? "granted" : "refused";
  } catch {
    return "refused";
  }
}

/** True only when the person pressed the granting button. */
export const consentGiven = async (dialog, parent, question) => (await askConsent(dialog, parent, question)) === "granted";
