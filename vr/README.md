# vr — Unity / Meta XR work mode

`/vr on` injects, into every message, a reminder of five working rules for Unity + Meta XR projects: read the official documentation
before wiring or asserting anything (`doc` skill of `claude-skills`), use `unity-mcp` to repair and Meta XR Operator to observe,
give a proof of the same type as the symptom (an image for a visual symptom), always leave Play mode after a test, and use one
Operator per player for multiplayer tests. `/vr off` removes it, `/vr status` shows the state (flag file `~/.claude/vr-mode.flag`,
one per machine). On Windows machines that have Meta's Operator proxy, the mod also registers the MCP servers `meta-xr-operator`
(player 1, port 8720) and `meta-xr-operator-j2` (player 2, port 8721).

The `multijoueur` skill (`skills/multijoueur/SKILL.md`) explains how to test with 2, 1 or 0 headsets. It does **not** include the
tool that made a copy of Meta's Operator layer listen on another port (it modified a Meta binary; see the repository README).
