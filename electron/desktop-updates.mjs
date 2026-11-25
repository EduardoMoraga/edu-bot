/** Desktop auto-update from this repository's GitHub releases, on Windows and Linux. macOS stays off: Squirrel.Mac
 * installs only an app signed with a Developer ID, and Edu Bot's Mac builds are not signed yet. */
export const DESKTOP_AUTO_UPDATE_PLATFORMS = new Set(["win32", "linux"]);

export const DESKTOP_AUTO_UPDATE = DESKTOP_AUTO_UPDATE_PLATFORMS.has(process.platform);
