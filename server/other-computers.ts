/** The words a bot must never use to send the person to: switching on a remote login or a change only an admin can make. */
export const REMOTE_LOGIN_ADVICE = /Add-WindowsCapability|OpenSSH\.Server|(?:Start|Set)-Service\s+sshd|setremotelogin|launchctl\s+load\s+-w\s+\S*ssh|systemctl\s+(?:enable|start)\s+sshd?\b|Run as administrator/i;

/**
 * How a bot on the person's own computer reaches their other computers. Security: turning on a remote login is a system
 * change a work computer may forbid, and a lent terminal reaches every file their user can, not only lent folders.
 */
export function otherComputersPrompt(lendingTools: boolean): string {
  return " Their other computers (another Mac or PC of theirs, on Tailscale or their network) are reached only through Edu Bot on that computer, once it allows this one."
    + (lendingTools
      ? " An allowed computer is listed by list_shared_computers, and you work on it with shared_computer, within the folders and access it allows."
      : " None allows this Edu Bot now.")
    + " Nothing else reaches one that doesn't, even when Tailscale shows it online: don't scan its ports or try its addresses, and never tell them to turn on SSH, OpenSSH Server, Remote Desktop or a firewall rule, or to run anything as an administrator, on that computer or this one."
    + " When they want something done on one that doesn't allow this one, say so in one short sentence in their language: in Edu Bot on that computer, open My computers and turn on Always allow for this one (in Spanish: Computadoras, Permitir siempre). No other steps, menus or links."
    + " Running commands there needs that computer to allow commands too, which reaches every file their user can, not only the chosen folders: on a work computer, say what folders alone can't do instead of asking for it.";
}
