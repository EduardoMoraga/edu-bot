# Edu brain: long-term memory for every bot

When [Edu](https://github.com/EduardoMoraga/edu) 6.0.0 or newer is installed, every bot gets an Edu brain next to its
own memory (`docs/memory.md`). The bot's `MEMORY.md` stays its working notes; the Edu brain holds durable decisions,
lessons, commitments and proposals, with Edu's claim bands (`verified`, `inferred`, `hypothesis`), and it is the same
brain Edu's other tools read.

Nothing needs to be set up: install Edu (`npm install -g edu-agent`) and the next turn of each bot has it.

## What a bot gets

Edu Bot starts Edu's own MCP server for the turn, as `edu mcp --profile memory`, on the bot's brain. The bot sees
Edu's memory tools only:

| Tool | Does | Asks first? |
| --- | --- | --- |
| `edu_brief`, `edu_recall`, `edu_read`, `edu_commitments`, `edu_capabilities`, `edu_projects` | read the brain | no |
| `edu_remember`, `edu_feedback`, `edu_session_open`, `edu_session_close` | write episodic and transitive notes | no |
| `edu_propose_canonical` | propose a canonical note; it stays `proposed` until a person accepts it | no |
| `edu_project_use` | switch brains | always refused: the brain is fixed for the turn |

"Asks first?" is for Claude bots below Full access, where these tools are pre-allowed. Codex asks for tools that are
not read-only, as it does for any server. Edu's crew tools (`edu_crew_*`, `edu_orchestrate`) are not mounted.

Canonical notes can only be proposed. Accepting one is a person's decision, made with `edu brain approve` in a
terminal (an approval card in Edu Bot comes next).

## Where the brain lives

Each bot's `eduBrain` setting (`PATCH /api/bots/:id`):

- absent or `{ "mode": "own" }`: a brain of its own at `<data folder>/brains/<bot id>/.edu`, created with
  `edu init --name <bot name>` on the bot's first turn. `edu init` also lists it in the global brain's
  `projects.json`, under the bot id, so Edu's own tools can find it.
- `{ "mode": "folder", "path": "/abs/path" }`: the brain already in that folder (`/abs/path/.edu`), which several bots
  can share, for example one brain per company area. Edu Bot never creates a brain there: run `edu init` in the
  folder first. Without one the bot gets no Edu tools.
- `{ "mode": "off" }`: no Edu brain.

Giving a bot a brain, or pointing it at another folder, counts as widening its access: from a local script it is
refused while any bot is working.

The global Edu brain (`~/.edu`, or `EDU_HOME`) is read alongside each bot's brain. Writes go to the bot's brain.

## Settings

`config.json`:

```json
{ "edu": { "enabled": true, "home": "~/.edu" } }
```

- `enabled: false` turns Edu off for every bot.
- `home`: the global brain, an absolute path or `~/…`. Default: `EDU_HOME`, else `~/.edu`.

`OMB_EDU_CLI` (environment) names Edu's `cli.js` when the `edu` on PATH is not npm's own link or shim, for example a
version-manager wrapper.

## When Edu is not there

A turn never fails because of Edu. With Edu missing, older than 6.0.0, broken, off, or with a shared folder that has
no brain, the bot simply has no Edu tools. `GET /api/bots/:id/memory` reports why, under `edu`:

```json
{ "state": "missing", "mode": "own", "home": "/home/me/.edu", "reason": "Edu is not installed", "brain": "…" }
```

`state` is `ready`, `off`, `missing`, `old` or `broken`. Edu is looked up again at most every 30 seconds, so
installing or updating it needs no restart.

Edu is mounted only when the engine runs on this computer: not on a Cloud, in a bot box, on a cloud or VPS computer,
in a proactive turn's fence or in a Bot API conversation.

## Safety

- The brain is fixed per turn: `--cwd <brain folder>` with `EDU_LOCK_WORKSPACE=1`, so `edu_project_use` cannot move
  a bot onto another brain, the global one included.
- A bot can propose canonical notes but never accept them: Edu has no MCP tool for that.
- On Claude bots the engine runs with `EDU_CREW_JOB=edu-bot:<bot id>`, which Edu reads as "a crew worker": the bot's
  own shell cannot run `edu brain approve` or start Edu crew jobs. Only the `edu` server has it cleared, so memory
  writes still work. Codex hands one environment to all of its MCP servers, and the other engines were not checked,
  so they do not get this guard yet. It is not a hard boundary: a shell can unset a variable.
- When Edu Bot itself runs inside an Edu crew job, the inherited guard stays on for the bots too, and Edu refuses
  their brain writes.

## Engines

Claude, Codex, Pi, the ACP engines (Grok, Gemini, OpenCode, Antigravity and the others), Muse Code and the API engines
with tools mount it. Tool selection applies as for any server: `mcp:edu:*`, or single tools such as
`mcp:edu:edu_recall`. A person's own MCP server named `edu` is shadowed by this one.

## Verify

```sh
pnpm exec vitest run server/edu-brain.test.ts
pnpm exec vitest run server/drivers/claude.test.ts -t "Edu brain"
pnpm exec vitest run server/edu-brain.real.test.ts server/edu-brain.e2e.test.ts   # need Edu installed; skipped otherwise
```

The real-binary tests run Edu in temporary folders only: the fixture's data folder, and a temporary global brain
passed to the launcher as `EDU_FIXTURE_HOME` (it refuses your own `~/.edu`). Without `EDU_FIXTURE_HOME` a fixture has
no Edu.
