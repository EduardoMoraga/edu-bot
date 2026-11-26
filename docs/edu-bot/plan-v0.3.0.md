# v0.3.0 plan (from v0.3.0-look-and-brand.md). Starts only after v0.2.0 is published.

One worker at a time (12 GB rule), each PR audited by Grok (C also by Agy: protocol and file migrations).
Commit that audit in `docs/edu-bot/reports/` as `YYYY-MM-DD-<milestone>-<reviewer>.md` (see that folder's README).
CI green, then merge. Order matters: README shots come last, after the look is final.

| PR | What | Worker | Est. |
| --- | --- | --- | --- |
| A | **Themes work in one click.** ThemeRow.tsx:32 calls `takeOffTheme()` like SkinPicker.tsx:93; Appearance opens the skin grid by default (`themes` true); custom theme editor shows only saved colours, live preview, Save offers/activates Use; font and chat width outside Advanced. Tests for each. | Claude Opus | 0.5-1 day |
| B1 | **Skins.** New "Edu" skin (light/dark pair) as the default for System (`DEFAULT_SKIN_CHOICE`, `THEME_SKINS`); Midnight renamed Classic with `PRIOR_INSTALL_SKIN` so existing installs keep their look; remove Halloween and Diwali (a saved choice of them falls back to Edu). | Claude Fable | 1 day |
| B2 | **Design pass.** Own typography, more air in Simple mode, sidebar hierarchy with the Edu accent, chat empty state (Edu illustration, 3-4 suggestions, "New bot"), new mascot replacing SupaMaus/MausAvatar. DESIGN.md updated. Screenshots en/es light/dark. | Claude Fable | 1.5-2 days |
| C | **Own brand in the app (Apache 2.0 kept).** LICENSE and NOTICE untouched; origin credit only in NOTICE and README footer. Remove `about.origin` from the UI; Documents/MausBot → Documents/Edu Bot with migration; `.mausbot-theme.json` → `.edubot-theme.json` reading the old name; "MausBot phone app", "OpenMaus Admin", `COMPANION_APP_NAME`, phone-activity.ts:99, companion/src texts; CONTRIBUTING.md and `pnpm omb`; new `edubot://` while `openmausbot://` and `_openmausbot._tcp` stay as documented compatibility. | Claude Opus | 1-1.5 days |
| D | **README as a product.** README.md and README.es.md: hero (logo, "Tu equipo de bots de IA, en tu computador"), shields.io badges, per-OS download buttons to /releases/latest, hero shot, demo GIF 12-18 s ≤ 5 MB, features grid, 4-6 shots EN/ES, mermaid architecture, comparison table, 3-step start, licence and credits at the end. New assets (hero-banner and og-social 1280x640, wordmark SVG, shots with the Edu skin). `keywords` in package.json. | Claude Fable | 1 day |
| — | v0.3.0 release (same path as v0.2.0) and reports/v0.3.0-look-and-brand.md. Social preview upload is a GitHub web setting: Edu Git or Eduardo uploads og-social.png. | Lead | 0.5 day |

Total about 5-7 days of agent work with audits. Done means: a new person opening repo and app sees only "Edu Bot",
changes the look in one click and notices it, README looks like a product; LICENSE and NOTICE intact.
