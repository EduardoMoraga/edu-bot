# Edu Bot

[Español](README.es.md)

Edu Bot is a desktop app for Linux, Windows, and macOS.
You chat with a roster of AI bots. Each bot can use an engine you already have.
Your chats stay on this computer. The app is open source.

![Edu Bot in English: Inbox, the helper Edu, and a new bot](docs/images/chat-en.png)

## Install

Download **0.1.0** from [GitHub Releases](https://github.com/EduardoMoraga/edu-bot/releases).

These installers are not signed. Your system asks before it opens them.

**macOS** (Apple silicon or Intel): `EduBot-0.1.0-arm64.dmg` or `EduBot-0.1.0-x64.dmg`. A `.zip` of the same build is on the release too.
Right-click the app and choose Open.
If macOS blocks it, open System Settings, then Privacy & Security, then Open Anyway.

**Windows** (64-bit): `EduBot-0.1.0-setup.exe`.
If SmartScreen appears, choose More info, then Run anyway.

**Linux** (64-bit):

- AppImage: `chmod +x EduBot-0.1.0-x86_64.AppImage`, then run that file.
- Debian package: `sudo apt install ./EduBot-0.1.0-amd64.deb`.

Each release includes `SHA256SUMS`. Compare the file you downloaded with that list before you open it.

The app does not update itself. Download the newer installer from Releases and install it the same way. Your chats stay in `~/.edubot`.

## First steps

1. Sign in to an engine on this computer. Edu Bot runs CLIs you already have, for example `claude`, `codex`, and Antigravity (`agy`, for Gemini). More engines are on **Model providers and accounts** in Settings.
2. Create a bot with **New bot**.
3. Connect apps with your own Composio project key (it starts with `ak_`), or add your own MCP servers. With no key, Apps tells you the steps. See [Connect apps](docs/composio.md) and [your own MCP servers](docs/custom-mcp-servers.md).
4. Add a read-only SQL connection in **Settings → Data → Data connections**. SQLite, DuckDB, and Postgres work. The password stays in the Vault. A bot reads only the tables you allow.

## Edu memory

Install [Edu](https://github.com/EduardoMoraga/edu) 6.0.0 or newer (`npm install -g edu-agent`). Each bot then gets an Edu brain. It can recall notes and propose new ones.

A canonical note stays a proposal until a person accepts it. A bot cannot approve one. The app still runs if Edu is missing.

Edu crew lets a bot ask other coding tools to plan work. It stays off until you turn it on for that bot. You approve each plan.

Details: [Edu brain](docs/edu-brain.md).

## Organisation profiles

An organisation, its areas, and its bots can live in files. Two people with the same folder get the same bots. Keys stay on each person's computer.

The app shows a plan first. Nothing changes until you apply it. A line marked **Gives more access** applies only after you allow it in the desktop app.

Open **Settings → Profiles**, or run `edubot profiles plan` and `edubot profiles apply`.

Details: [Profiles](docs/profiles.md).

## Privacy

Edu Bot sends no usage analytics. The desktop app does not check for updates.

A feature contacts a service only when you use it. The list is in [Network](docs/edu-bot/network.md).

Chats, bots, and settings stay in `~/.edubot` on this computer. See [where the files live](docs/edu-bot/data.md).

## Build from source

You need Node.js 24 or newer and pnpm 10.33.0. `package.json` names both.

```sh
git clone https://github.com/EduardoMoraga/edu-bot.git
cd edu-bot
pnpm install
pnpm dev:server
pnpm dev
```

`pnpm dev:server` is the local server. `pnpm dev` is the app in a browser. `pnpm dev:desktop` opens the desktop window. Leave the server running.

`pnpm lint` checks this checkout. [CI](docs/ci.md) says which tests run.

To contribute, branch from `main` and open a pull request on this repository.

## Licence and credits

Edu Bot is [Apache-2.0](LICENSE). Copyright lines are in [NOTICE](NOTICE).

Edu Bot is based on [OpenMausBot](https://github.com/milind-soni/OpenMausBot). It is a separate project. It is not affiliated with Supamaus Software Private Limited or the OpenMausBot project.

Third-party programs inside the installers are listed in [third-party binaries](docs/edu-bot/third-party-binaries.md).
