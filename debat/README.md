# debat — a framed debate between two agents, followed live

`/debat` opens a side panel with a form: the **question** (FOR = yes, AGAINST = no), the **framework** that no argument may leave,
the **criterion** that decides who is right, the **shared facts**, a name and a number of rounds (1–6). **Launch** runs
`lancer-debat.py`, which writes the debate folder (`cadre.md`, `debat.md`, two instruction files) and starts two agents
(`claude -p --permission-mode bypassPermissions` by default; any command reading the instruction on stdin works through
`DEBAT_AGENT_CMD`). They take turns appending `## Tour N — POUR` / `## Tour N — CONTRE` sections to `debat.md`; the panel
shows the thread as chat bubbles, refreshed every 20 s, and "Débat terminé" when both `pour.fin` and `contre.fin` exist.

Options: `hote` (an SSH `user@machine` where the debates run; empty = this machine), `racine` (debates folder, default `~/debats`),
`lanceur` (command that creates a debate, default `python3 lancer-debat.py` — give the full path to the script).
Note that the agents run with bypassed permissions: only use the mod on a machine where that is acceptable.
