# campagne — campaign manager mode

The session that activates a campaign becomes its **manager**. Every `cadence_min` minutes a manager pass is
mandatory: are the agents working (otherwise step in), do their questions have an answer (decide alone, or set aside for the
user without stopping the campaign), has every verdict been read. At the end of each turn the code runs the OK/KO script of
every obligation and sends a recovery message while one is KO (bounded to 4 retries).

Shows a side panel (tasks with their phase, open questions, last pass) and a band above the prompt.

## Commands

- `/campagne nouvelle` — Claude helps you define a campaign, one question at a time, and writes its files
- `/campagne start <slug>` — validates and starts `<racine>/<slug>/campagne.json` (default root `~/campagnes`, option `racine`)
- `/campagne passage` — a manager pass right now · `/campagne stop` · `/campagne` — panel

## `campagne.json`

```json
{
  "titre": "Migration of the reports",
  "but": "All reports exported in the new format",
  "ou": "Where the agents and the tools run",
  "cadence_min": 15,
  "releve": "releve.sh",
  "interdits": "Never touch the production database",
  "arret": { "texte": "all reports are exported", "controle": "controles/arret.sh" },
  "obligations": [
    { "id": "O1", "titre": "Agents are working", "attendu": "at least one agent active in the last 20 min",
      "controle": "controles/agents.sh", "si_ko": "restart the idle agent with its full prompt" }
  ]
}
```

- A **control script** runs in the campaign folder; its **last line** starts with `OK` or `KO` followed by the measured fact.
- `releve.sh` prints one JSON line the panel displays: `{taches:[{id,titre,poste,attend,statut,phase,jugees,refus,dernier,activite_min}], agents, demandes, services, disque_go, verdicts, journal}` (all optional; `phase` is one of `validee`, `travail`, `juge`, `attente`, `arret`).
- `questions.json` (optional): `[{id, de, question, depuis, demande?, statut?}]`; questions with `statut` absent or `ouverte` are shown.
- Traces: `etat.json` and `passages.jsonl` in the campaign folder.
- Times in the traces are Paris time (the schedule is by minute of the hour, so it is not affected by your time zone).
