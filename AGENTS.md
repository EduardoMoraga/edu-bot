# Edu Bot agent notes

This checkout is Edu Bot (https://github.com/EduardoMoraga/edu-bot), a fork of
OpenMausBot. Apache-2.0 attribution stays in `LICENSE` and `NOTICE`.

Read [`docs/edu-bot/MISSION.md`](docs/edu-bot/MISSION.md) for the product brief
and [`docs/edu-bot/PROGRESS.md`](docs/edu-bot/PROGRESS.md) for what is already
verified. `PROGRESS.md` is plain Spanish.

Before claiming a server or conversation change works, follow
[`docs/verification/README.md`](docs/verification/README.md). Always launch an
isolated fixture; never verify mutations against the user's live app or data.

UI changes follow [`DESIGN.md`](DESIGN.md).

Phone pairing uses the published MausBot apps for iOS and Android. Edu Bot does
not publish a phone app, and this repo does not rebuild one. Pairing links stay
`openmausbot://pair` and nearby discovery stays `_openmausbot._tcp`, because
those are the names the store apps register. The same note is in
[`docs/edu-bot/data.md`](docs/edu-bot/data.md).

## Comments

Write a comment only for what the code cannot say:

- a license or attribution notice;
- a fact forced by something outside this code (a vendor, CLI, OS, browser,
  Electron or protocol behaviour), with its version when it has one;
- the doc comment of a public contract: the wire types in `shared/`, the
  driver interface, the preload bridge, `config.json` fields people edit;
- a link to an upstream issue;
- a security invariant or a known open risk.

Do not narrate what the next line does, restate a name, record history ("used
to", "no longer", PR or issue numbers, plan or slice names: git has it), point
at other files, draw banners or leave commented-out code. When our own code
needs a paragraph to explain a surprise, change the code instead: a better
name, a type, an extracted function, one shared helper. A rule ("never X",
"must match Y") belongs in a type, a test or a lint rule. Never suppress a lint
rule that guards correctness; fix the code.

More specific `AGENTS.md` files override this note within their directories.
