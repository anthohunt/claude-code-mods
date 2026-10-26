# taches-autonomes — autonomous tasks panel

`/taches` opens a panel listing the task cards of a folder (default `~/.claude/autonomous-tasks`, option `registre`),
sorted running → ready → draft → stopped → succeeded. **Start** and **Stop** buttons send
`/launch-autonomous-task …` to the session; a toast announces new tasks, status changes, ticked criteria, and a running task
whose card has not been touched for 30 minutes.

A card is a Markdown file with a header and two sections the panel reads:

```markdown
---
slug: migrate-reports
statut: brouillon | prête | en cours | réussie | arrêtée
---
## Critères de réussite
- [ ] C1 — a verifiable fact · se vérifie par : a command
- [x] C2 — another one · se vérifie par : …
## Journal
- 2026-10-26 14:02 — started
```

The cards are written by the skills `add-autonomous-task` and `launch-autonomous-task` of the companion repository `claude-skills`.
