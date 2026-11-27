export const APP_ID = "io.github.eduardomoraga.edubot";
export const DESKTOP_ENTRY_NAME = `${APP_ID}.desktop`;
export const PRODUCT_NAME = "Edu Bot";
/** The line the server prints once it listens; the desktop app waits for it on the server's stdout. */
export const SERVER_LISTENING_LINE = `${PRODUCT_NAME} server on `;
export const CLI_NAME = "edubot";

export const DATA_DIR_NAME = ".edubot";
export const COMPANION_DIR_NAME = `${DATA_DIR_NAME}-companion`;
export const SERVER_CHILD_DIR_NAME = `${DATA_DIR_NAME}-server-child`;
export const SECRET_FOLDER_NAME = `${DATA_DIR_NAME}-secrets`;
export const dataDirNameFor = slug => `${DATA_DIR_NAME}-${slug}`;

export const DEEP_LINK_SCHEME = "edubot";
export const DEEP_LINK_PREFIX = `${DEEP_LINK_SCHEME}://`;
/** Links written before the app had its own scheme. They open like edubot:// ones, but the scheme is never registered
 * with the OS, so an OpenMausBot installed beside it keeps its own links. */
export const LEGACY_DEEP_LINK_PREFIX = "openmausbot://";
export const ownDeepLink = value => typeof value === "string" && value.slice(0, LEGACY_DEEP_LINK_PREFIX.length).toLowerCase() === LEGACY_DEEP_LINK_PREFIX
  ? DEEP_LINK_PREFIX + value.slice(LEGACY_DEEP_LINK_PREFIX.length)
  : value;

// The published MausBot phone apps register only this scheme, so a pairing link meant for a phone must use it.
export const PHONE_LINK_SCHEME = "openmausbot";
// The published MausBot phone apps browse for this Bonjour service type to find a computer nearby.
export const PHONE_DISCOVERY_SERVICE_TYPE = "_openmausbot._tcp";

export const LINUX_EXECUTABLE_NAME = "edu-bot";
// Chromium's setuid sandbox launch (CommandLine::PrependWrapper, Electron 43) splits the sandbox path on spaces, so the
// Linux install folder must have none. electron-builder 26 installs to /opt/<productName>; the Linux package scripts
// set productName to this name.
export const LINUX_INSTALL_DIR = `/opt/${LINUX_EXECUTABLE_NAME}`;
export const BROWSER_APPARMOR_PROFILE = "edubot-browser";
