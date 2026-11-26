@AGENTS.md

# Edu Bot

Mission: [docs/edu-bot/MISSION.md](docs/edu-bot/MISSION.md).

Progress log: [docs/edu-bot/PROGRESS.md](docs/edu-bot/PROGRESS.md). Update it when a milestone changes. Write it in short, plain Spanish.

Run tests with `TMPDIR=/var/tmp/edubot-tests`.

At most 2 agents at once.

Never merge to `main`. A PR needs green CI and Eduardo's approval.

Always target `EduardoMoraga/edu-bot`. Never target upstream `milind-soni/OpenMausBot`.

`gh` commands must include `--repo EduardoMoraga/edu-bot`. `gh pr merge` is refused.
