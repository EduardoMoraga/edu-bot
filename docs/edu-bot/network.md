# Network: what Edu Bot contacts, and when

Edu Bot sends no usage analytics and no crash reports. It does not contact the upstream OpenMausBot project's
services unless you configure them. This page lists every outbound host that remains, grouped by when it is contacted.

## On its own, with nothing configured

| Host | What | When | Turn it off |
| --- | --- | --- | --- |
| `raw.githubusercontent.com/EduardoMoraga/edu-bot` | The model list (`server/model-manifest/model-manifest.json`) | At start and about hourly; a plain GET with nothing of yours in it | `OMB_DISABLE_MODEL_MANIFEST_FETCH=1` |
| `models.dev` | The public model catalog (`/api.json`) | At most once a day | `OMB_DISABLE_MODEL_CATALOG_FETCH=1` |
| `registry.npmjs.org` | The newest Codex version (`@openai/codex/latest`) | At start and at most hourly, to tell whether the Codex engine is current | — |

The server also probes local model servers on this computer (Ollama, LM Studio and similar, on `127.0.0.1`), and
starts each engine CLI installed on this computer to read its version and sign-in. Those CLIs are third-party
programs and may contact their own vendor when they start; for example, Cursor's CLI calls `api2.cursor.sh`.

Checked on an isolated server (empty data folder and home, nothing configured): in its first minute it made exactly two
outbound requests of its own, the model list above and the Codex version check.

The desktop app does not update itself and does not check for updates: auto-update stays off
(`electron/desktop-updates.mjs`) until Edu Bot publishes its own signed releases.

## When you use a feature

| Host | What | When |
| --- | --- | --- |
| The AI providers you set up (Anthropic, OpenAI, Google, xAI, OpenRouter and the others in Settings) | Model calls, sign-in, usage | When a bot runs on that provider; each engine's CLI also talks to its own vendor |
| `registry.npmjs.org` | Engine installs | When you install or update an engine |
| `storage.googleapis.com`, `dl.google.com` | Chrome for Testing for the bots' browser; the Antigravity engine | When you install them |
| `github.com/milind-soni/OpenMausBot/releases` | The pinned Windows browser-engine binary (checked by hash) | When the browser engine is installed on Windows |
| `raw.githubusercontent.com/milind-soni/openmausbot-teams` | The team library catalog | When you open the team library |
| `extensions.duckdb.org` | DuckDB extensions | When a data tool needs one |
| `backend.composio.dev` | Connected apps (OAuth grants) | Only with your own Composio key, or a broker you run (`OMB_COMPOSIO_BROKER_URL`) |
| ElevenLabs, Fish Audio, other voice services | Speech | Only when you turn on that voice engine with your key |
| Websites, MCP servers and APIs your bots use | Whatever the bot's tools do | When a bot calls them |
| `cloud.openmausbot.com` | A `HEAD` request to read the clock | Only when you run the `doctor` command on a headless server |

## Only when you configure it

| Host | What | Switch |
| --- | --- | --- |
| `api.github.com/repos/EduardoMoraga/edu-bot`, `raw.githubusercontent.com/EduardoMoraga/edu-bot/channels` | Update check for a self-hosted server (npm, Docker or git install), when its page asks. No release yet means "up to date", never an error | Always on for those installs; the desktop app never asks |
| `raw.githubusercontent.com/EduardoMoraga/edu-bot` | The announcements file | `OMB_ANNOUNCEMENTS=1` (off by default) |
| The address you give | `@devs` bug reports and their status | `OMB_BUG_REPORT_URL` (off by default; the `@devs` mention is hidden without it) |
| The control plane you give | Phone relay, `serve --tunnel`, emailed sign-in codes | `OMB_CONTROL_PLANE_URL` (none by default; LAN and Tailscale still work) |
| Your own mail server | Emailed sign-in codes | `OMB_SIGNIN_SMTP_URL` |
| `cloud.openmausbot.com` | The upstream MausBot Cloud account (sign-in, plans, product-update consent) | `OMB_CLOUD_ACCOUNT=1` (or `OMB_CLOUD_STAGING=1` for its staging Admin) |
| The broker you give | A managed Composio broker | `OMB_COMPOSIO_BROKER_URL` |

## Removed

- PostHog usage analytics in the app and the desktop launch counters: removed with the `posthog-js` dependency.
- The upstream sponsor and promotion cards from the announcements feed.
