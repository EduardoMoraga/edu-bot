# Data: where Edu Bot keeps its files

Edu Bot has its own identity on the computer, separate from the upstream OpenMausBot app. Both can be installed on
the same machine without sharing data, settings or links.

| What | Where |
| --- | --- |
| Workspace data (bots, chats, settings, `config.json`) | `~/.edubot`, or the folder `OMB_DATA_DIR` names |
| Phone and device pairing state | `~/.edubot-companion` (`OMB_COMPANION_DIR` overrides it) |
| Another local workspace you add | `~/.edubot-<name>` |
| A bot's short-lived private secrets | `.edubot-secrets` inside that bot's workspace |
| Desktop window state and encrypted credentials | Electron's user-data folder: `~/.config/Edu Bot` on Linux, `~/Library/Application Support/Edu Bot` on macOS, `%APPDATA%\Edu Bot` on Windows |
| Saved servers for the `edubot` command | `~/.config/edubot` (`$XDG_CONFIG_HOME/edubot`, `%APPDATA%\edubot`) |
| Sentinel health scans | `~/.local/state/edubot-sentinel` (macOS: `~/Library/Application Support/edubot-sentinel`) |

The names come from one module, `electron/app-identity.mjs`, which the desktop app, the server and the interface all
import.

## An existing OpenMausBot folder is never read or moved

If `~/.edubot` does not exist, Edu Bot creates a new, empty one. It does not look inside `~/.openmausbot` (or the
older `~/.opengrokbot`), does not copy or rename it, and does not delete it. The old folder stays exactly as it was,
so the OpenMausBot app keeps working with it.

Edu Bot also never uploads `~/.openmausbot` when it syncs files to a Cloud: it is on the same private list as
`~/.edubot`, `~/.ssh` and other app folders.

There is no supported import from OpenMausBot yet. Copying the folder by hand is untested: paths saved inside it
(in bots' notes and chats, for example) may still point at `~/.openmausbot`, and credentials the OpenMausBot desktop app encrypted stay with that app.

## Other identifiers

| Identifier | Value |
| --- | --- |
| Application id (Linux desktop entry, macOS bundle, Windows AppUserModelId) | `io.github.eduardomoraga.edubot` |
| Links the desktop app opens | `edubot://` (`thread`, `bot`, `cloud`, `organization`, `install`, `team`, `use-my-computer`) |
| Command line | `edubot` (`pnpm omb` in a checkout) |
| Linux install folder and command | `/opt/edu-bot/edu-bot` |
| Linux browser sandbox policy | AppArmor profile `edubot-browser` |

Two identifiers keep their OpenMausBot values on purpose, because the only phone apps that exist are the published
MausBot apps for iOS and Android, and Edu Bot does not control them:

- **Phone pairing links** stay `openmausbot://pair?…`. That is the only link scheme the phone apps register, so a QR
  code with any other scheme would not open them.
- **Nearby discovery** stays the Bonjour service type `_openmausbot._tcp`. That is the type the phone apps browse
  for. The computer's mDNS host name is Edu Bot's own (`edubot-<hash>.local`).

Environment variables keep their `OMB_` prefix.

## Names kept for compatibility

Everything a person reads says Edu Bot. These names keep their old form on purpose, because something outside
this app looks for them, or because changing them would break an install, a paired phone or a saved file:

| Name | Why it stays |
| --- | --- |
| `openmausbot://pair?…` links and the `_openmausbot._tcp` service | The published phone apps only open and browse for these (see above). |
| The phone app's name in the App Store and Google Play: "MausBot" | Edu Bot does not publish those apps. The pairing and update texts say what to search for. |
| `openmausbot://` desktop links | Still opened, like `edubot://`, but never registered with the OS, so an OpenMausBot installed beside Edu Bot keeps its own links. |
| `app: "openmausbot"`, `x-openmausbot-*` headers, `openmausbot:*` messages between the desktop app and its helpers | Older servers, companions and phone apps check them. |
| `OMB_*` environment variables, `omb-*` browser storage keys, `@openmausbot/*` package names, `pnpm omb` | Saved settings, scripts and existing installs use them. |
| The bundled skill id `openmausbot-docs` | Bots and saved skill lists name it. A model can see this id; its name and text say Edu Bot. |
| `Documents/MausBot` | If Edu Bot's own Files put work there, it is renamed to `Documents/Edu Bot` once. If both folders exist, Edu Bot uses `Documents/Edu Bot` and leaves `Documents/MausBot` as it is; a `Documents/MausBot` this app never wrote to belongs to OpenMausBot and is not touched. |
| `.mausbot-theme.json` | Themes export as `.edubot-theme.json`; import still reads the old files. |

