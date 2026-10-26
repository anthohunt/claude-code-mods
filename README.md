# claude-code-mods — five small mods for Claude Code, plus a Meta XR mode

Mods are Claude Code extensions made of hooks (a command, a side panel, a band above the prompt, a text
injected into every message). This repository holds six of them. Each one is a folder you can load on its own.

> Claude Code mods are an **early-access** API and can change between versions. These mods were written
> against Claude Code 2.1.x. The code comments and most user-facing strings are in French.

| Mod | What it does | Command |
|---|---|---|
| [`autotask`](autotask/README.md) | A **mission** in a strict JSON file, woken at fixed minutes by the code, checked by OK/KO scripts, with a reply format the code verifies. No judge model. | `/autotask start <slug>` |
| [`campagne`](campagne/README.md) | A **campaign manager** mode: side panel (tasks, agents, open questions), band above the prompt, and a mandatory manager pass at a fixed pace, checked by scripts. | `/campagne` |
| [`taches-autonomes`](taches-autonomes/README.md) | A dashboard of autonomous tasks (one Markdown card per task), with Start/Stop buttons and notifications when a task goes silent. | `/taches` |
| [`debat`](debat) | A side panel that follows, live, a framed debate between two agents (FOR / AGAINST), read from a folder. Includes the script that starts the debate. | `/debat` |
| [`modes-reponse`](modes-reponse) | Two persistent answer modes: short answers (TL;DR) and plain-language explanations. | `/tldr`, `/mode-simple` |
| [`vr`](vr) | A Unity / Meta XR work mode (rules injected into each message) and a multiplayer test skill with one Meta XR Operator per player. | `/vr on|off|status` |

## Install

Requirements: [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (logged in), Node.js ≥ 18.
`bash` is needed by `autotask` and `campagne` (their control scripts); `debat` needs Python 3 and, only for a remote
machine, SSH.

```bash
git clone https://github.com/anthohunt/claude-code-mods.git
cd claude-code-mods
claude --plugin-dir ./autotask --plugin-dir ./debat          # one or several mods, for one session
# or always: CLAUDE_CODE_PLUGIN_DIRS="$PWD/autotask:$PWD/debat" claude
claude plugin validate ./autotask                            # checks one mod
```

Mod options (folder of the missions, remote machine, …) are set in `/config`, or under
`pluginConfigs["<mod>@inline"].options` in your Claude Code settings. Every path has a default under your home
folder (`~`), nothing is tied to a machine.

## The mods in a few lines

- **autotask** — folder `~/autotask/<slug>/mission.json` with stop criteria and monitoring tasks, each backed by a
  script whose last line says `OK …` or `KO …`. The mod builds the wake-up message itself, runs every script at the
  end of the turn and sends a recovery message listing exactly what is missing. See [its README](autotask/README.md).
- **campagne** — folder `~/campagnes/<slug>/campagne.json` (+ `releve.sh`, `controles/`, `questions.json`). `/campagne nouvelle`
  asks Claude to help you define one, one question at a time.
- **taches-autonomes** — reads `~/.claude/autonomous-tasks/*.md`. The cards are written by the skills
  `add-autonomous-task` / `launch-autonomous-task` of the companion repository `claude-skills`.
- **debat** — `/debat` opens a form (question, framework that no argument may leave, deciding criterion, shared facts,
  number of rounds). `lancer-debat.py` writes the debate folder and starts two agents (`claude -p` by default, or any
  command given in `DEBAT_AGENT_CMD`) that take turns appending to `debat.md`; the panel shows the thread. Options:
  `hote` (SSH machine, empty = this machine), `racine`, `lanceur` (path of `lancer-debat.py`).
- **modes-reponse** — two flags kept per machine; while on, a short instruction is added to every message.
- **vr** — the reminder (documentation before code, a picture as proof of a visual symptom, always leave Play mode
  after a test, one Operator per player) and the `multijoueur` skill.

## Known limits

- Times written in logs and shown by `autotask` and `campagne` are **Paris time** (EU daylight-saving rules). Schedules are given as
  minutes of the hour, so they do not depend on your time zone.
- Tests (`claude plugin test ./<mod>`, Claude Code 2.1.310): `debat`, `modes-reponse`, `taches-autonomes` and `vr` pass; `autotask` passes
  13 of 15 (the two failing tests, "stop criterion" and "STOP file", were written for Claude Code 2.1.295 and were not investigated further; the same two fail on the original code);
  `campagne` has no test.

## About the `vr` multiplayer skill and Meta's binaries

The original toolbox included a script that **copied and edited Meta's `XrApiLayer_METAX_operator.dll`** to make it
listen on another port. That script is **not included**: Meta's terms for redistributing a tool that modifies its
binaries could not be confirmed (no licence text is published with the Meta XR Operator, only a pointer to Meta's
developer policies). `vr/skills/multijoueur/SKILL.md` explains the problem; `lancer-joueurs.sh` simply expects one
Operator layer per port that you provide (`COUCHE_8731=…`). With two headsets (or one headset and one Simulator) you do
not need it.

## Licences

- Code: [Apache License 2.0](LICENSE) (see [NOTICE](NOTICE)).
- Texts, documentation and the skill file: [Creative Commons Attribution 4.0](LICENSE-docs).
- Nothing third-party is embedded. The `types/` folders describe the data each mod keeps (written by the author);
  the `.claude-plugin/types/` folders that Claude Code generates itself belong to Anthropic and are not in this
  repository (`.gitignore`). `vr/skills/multijoueur/juge_deux_joueurs.py` uses [Pillow](https://python-pillow.org)
  (HPND licence); the Meta XR Simulator and Meta XR Operator are Meta products you install yourself.
