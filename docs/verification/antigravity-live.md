# Antigravity live verification (`agy` CLI)

`server/antigravity-live.e2e.test.ts` verifies the Antigravity engine end to end
against a locally installed, signed-in `agy` CLI (v1.5+, `agy acp --stdio`).

It is skipped by default (including in CI) unless `EDUBOT_ANTIGRAVITY_LIVE=1` is
set in the environment.

## Prerequisites

- Official `agy` CLI (v1.5 or newer, supporting `agy acp --stdio`) installed on
  `PATH` (or pointed to by `EDUBOT_ANTIGRAVITY_CLI`), already signed in with a
  Google account that has Antigravity access.

## Running

```sh
TMPDIR=/var/tmp/edubot-agy-live \
EDUBOT_ANTIGRAVITY_LIVE=1 \
pnpm exec vitest run --maxWorkers=2 server/antigravity-live.e2e.test.ts
```

Optional overrides:

- `EDUBOT_ANTIGRAVITY_CLI=/abs/path/to/agy` — pin a specific `agy` executable
  instead of resolving `agy` from `PATH`.

## Isolation and what is shared

The test starts an isolated Edu Bot server via `verificationServerEnvironment`
(`scripts/control-omb.ts`) with a disposable `HOME`, `OMB_DATA_DIR`, and
disabled Edu CLI (`OMB_EDU_CLI=<temp>/no-edu`). It never touches `~/.edubot`,
`~/.openmausbot`, or `~/.edu`.

Only the path to the real `agy` executable (and the host `agy` login that `agy`
reads itself) is shared with the fixture's `antigravity` instance in
`<temp>/config.json`. No credentials or tokens are copied into the repo,
fixture config, or test output.

## What it checks

1. Engine detection and authentication (`GET /api/instances` reports
   `state: "available"` and `authenticated: true`).
2. Live model discovery (`POST /api/instances/antigravity/refresh-models` returns
   at least one `gemini-*` model).
3. Basic turn: creates a bot on Antigravity with a Gemini model and sends a
   short prompt (`"Reply with the word OK and nothing else."`), confirming the
   reply contains `OK`.
4. Edu Bot `agents` MCP tool call: asks the bot to call `list_bots` and checks
   that the tool returns the isolated fixture's peer bot (`Live Peer Sentinel`).
5. Turn cancellation: starts a longer reply, interrupts it mid-turn, and
   confirms the turn settles cleanly.

Total usage is kept to three short turns per run.
