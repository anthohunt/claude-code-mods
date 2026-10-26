# autotask-v2

Mod Claude Code : une **mission** définie dans un fichier strict, réveillée par le code aux minutes prévues (heure de Paris), contrôlée par des **scripts OK/KO**, avec un **format de réponse imposé** que le code vérifie. Aucun modèle juge : tout se décide par scripts et comparaison de texte.

## Mission : `<racine>/<slug>/mission.json`

Racine par défaut `~/autotask` (option `racine`). Validé au `start` ; tout champ manquant, vide, inconnu ou mal typé est refusé avec la liste des erreurs ; un script dont le chemin n'existe pas aussi.

```json
{
  "titre": "…", "mission": "une phrase",
  "frequence": [7, 22, 37, 52],
  "arret": [{ "id": "A1", "texte": "…", "controle": "controles/a1.sh", "issue": "accomplie" }],
  "monitoring": [{ "id": "M1", "titre": "…", "attendu": "…", "controle": "controles/m1.sh", "si_ko": "…" }],
  "surveillance": [{ "id": "S1", "titre": "…", "attendu": "…", "controle": "controles/s1.sh", "si_ko": "…" }],
  "reponse": [
    { "cle": "Mission", "modele": "<où on en est> · arrêt le plus proche : <critère>" },
    { "cle": "Monitoring", "modele": "✓/✗ <id> <fait>", "taches": "monitoring" },
    { "cle": "Surveillance", "modele": "✓/✗ <id> <fait>", "taches": "surveillance" },
    { "cle": "Pour toi", "modele": "rien, ou une seule question", "motif": "^(rien|[^?]*\\?)$" }
  ]
}
```

- **Script de contrôle** : lancé par `bash -c "<controle>"` dans le dossier de la mission ; sa **dernière ligne** commence par `OK` ou `KO` suivie du fait mesuré. OK seulement si la ligne dit OK **et** le code de sortie est 0 ; délai dépassé (option `delaiControle`, 120 s) = KO.
- **Arrêt** : un critère dont le script dit OK, ou un fichier `<slug>/STOP`, arrête la mission (état `accomplie` ou `arretee` selon `issue`, défaut `arretee`) ; plus aucun passage ; un dernier message demande le compte rendu.
- **Réponse** : chaque ligne `Clé : …` doit être présente (gras/puces tolérés), vérifier son `motif` s'il y en a un ; chaque tâche doit être marquée `✓ <id>` (seulement si son script dit OK) ou `✗ <id>`, dans la ligne qui porte sa section (`taches`), suivie du fait mesuré (comparé sans casse, guillemets ni nombres, qui bougent d'une seconde à l'autre).

## Déroulé

1. À chaque minute prévue (tic toutes les 20 s), si aucun passage n'est en cours : STOP et scripts d'arrêt, puis **message de réveil** construit par le code (`[autotask] <titre> — passage de HH h MM`, réf., mission, état des arrêts, tâches de monitoring puis de surveillance avec attendu / script / si KO, format exact), envoyé comme message de l'utilisateur. Un passage en cours n'en empile pas un autre (compté « sauté »).
2. **Fin du tour** du passage : le mod lance tous les scripts (arrêt, monitoring, surveillance) en parallèle, puis vérifie la réponse. Script KO, ligne absente, marque fausse ou fait non repris → **message de reprise immédiat** qui liste exactement ce qui manque (tâche, sortie du script, si KO). Au plus 5 reprises d'affilée (option `reprisesMax`), puis attente du passage suivant (`dernierPassage.issue = "borne"`).
3. Traces : `<slug>/etat.json` (état complet) et `<slug>/passages.jsonl` (start, réveil, passage, reprise, sauté, borne, arrêt, stop : heure, sortie de chaque script, conformité).

## Commandes

- `/autotask start <slug>` — valide et active la mission (ouvre le panneau)
- `/autotask stop` — arrête la mission
- `/autotask passage` — un passage tout de suite
- `/autotask` — état : mission, prochain passage, dernier résultat de chaque tâche et critère

Panneau « Autotask » (terminal et Desktop) : titre, statut / prochain passage, reprises, critères d'arrêt, chaque tâche ✓/✗ avec la ligne de son script.

## Lancer

```bash
claude --plugin-dir ./autotask
# puis : /autotask start ma-mission
```

Options (`/config`, ou `pluginConfigs["autotask-v2@inline"].options` dans les réglages) : `racine`, `delaiControle`, `reprisesMax`.

## Vérifier

```bash
claude plugin validate ./autotask
claude plugin test ./autotask
```
