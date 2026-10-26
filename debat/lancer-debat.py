#!/usr/bin/env python3
"""Lance un débat cadré entre deux agents (POUR / CONTRE).

Entrée standard : la fiche en JSON {"id","question","acquis","critere","faits","tours"}.
Sortie : une ligne « id <nom> » quand les deux agents sont lancés.

Réglages (variables d'environnement) :
  DEBAT_RACINE     dossier des débats (défaut ~/debats) ; un sous-dossier par débat
  DEBAT_AGENT_CMD  commande qui lit la consigne sur son entrée standard et joue un camp
                   (défaut : claude -p --permission-mode bypassPermissions)

Le débat vit dans <racine>/<id>/ : cadre.md, debat.md (le fil, que le mod lit), consigne-pour.md,
consigne-contre.md, et pour.fin / contre.fin quand un agent a terminé.
"""
import json, os, re, subprocess, shlex, sys

fiche = json.load(sys.stdin)
did = re.sub(r'[^a-z0-9-]', '', str(fiche.get('id', '')).lower())[:24] or 'debat'
tours = max(1, min(int(fiche.get('tours') or 4), 6))
base = os.path.expanduser(os.environ.get('DEBAT_RACINE', '~/debats'))
agent = os.environ.get('DEBAT_AGENT_CMD', 'claude -p --permission-mode bypassPermissions')
d = os.path.join(base, did)
if os.path.exists(d):
    sys.exit(f'déjà existant : {d}')
os.makedirs(d)
fil = os.path.join(d, 'debat.md')

cadre = f"""## Le cadre du débat (il s'impose aux deux camps)
• **Question** : {fiche['question']}
• **Cadre (acquis, ne se discute pas)** : {fiche.get('acquis') or '—'}
• **Critère pour trancher** : {fiche['critere']}
• **Faits partagés** : {fiche.get('faits') or '—'}
"""
open(os.path.join(d, 'cadre.md'), 'w').write(cadre)
open(fil, 'w').write(f"# {fiche['question']}\n\n")

regles = f"""{cadre}
## Règles
• Un camp répond OUI à la question (POUR), l'autre NON (CONTRE). But : se convaincre mutuellement par une vraie réflexion, sans mauvaise foi. Concède explicitement un argument juste et ajuste ta position. Réponds toujours à la version la plus forte de l'argument adverse.
• Le cadre est la loi du débat : tu ne remets jamais en cause un acquis et tu ne sors jamais de ce cadre. Si l'adversaire en sort, signale-le en une phrase et recentre. Chaque intervention fait avancer le débat vers le critère pour trancher.
• Chaque fait a une source (lien ou fichier). Distinguer « je sais » / « je pense » / « je ne sais pas ».
• Phrases simples, chaque terme technique expliqué en une phrase. 250 mots maximum par intervention.

## Déroulé (fichier partagé : {fil})
• {tours} tours. Ordre : Tour 1 POUR, Tour 1 CONTRE, Tour 2 POUR, … Tour {tours} CONTRE.
• Chaque intervention s'AJOUTE à la fin du fichier (jamais d'écrasement), sous le titre exact `## Tour N — POUR` ou `## Tour N — CONTRE`.
• Pour attendre l'autre : boucle au premier plan, par exemple `timeout 2700 bash -c 'until grep -q "^## Tour N — CONTRE" "{fil}"; do sleep 20; done'`. Délai expiré : écris ta position finale avec ce que tu as et termine.
• Après le Tour {tours} CONTRE : le CONTRE ajoute `## Position finale — CONTRE`, puis le POUR (qui l'attend) ajoute `## Position finale — POUR`. 150 mots max : ta réponse à la question selon le critère pour trancher, ce que l'autre t'a fait concéder, ce qui reste en désaccord et ce qu'il faudrait mesurer pour le lever.
"""
roles = {
    'pour': "# Ton rôle : camp POUR (réponse OUI)\nTu ouvres le débat (Tour 1 POUR) dès ton démarrage, puis tu attends chaque Tour N — CONTRE avant d'écrire le Tour N+1 — POUR.\n\n",
    'contre': "# Ton rôle : camp CONTRE (réponse NON)\nPrépare tes recherches, puis attends « ## Tour 1 — POUR » avant d'écrire ton Tour 1 — CONTRE ; ensuite attends chaque Tour N — POUR avant ton Tour N — CONTRE.\n\n",
}
for camp, intro in roles.items():
    consigne = os.path.join(d, f'consigne-{camp}.md')
    open(consigne, 'w').write(intro + regles)
    # L'agent lit sa consigne ; quand il a fini, le fichier <camp>.fin le dit au mod.
    cmd = f'{agent} < {shlex.quote(consigne)} > {shlex.quote(os.path.join(d, camp + ".log"))} 2>&1; touch {shlex.quote(os.path.join(d, camp + ".fin"))}'
    subprocess.Popen(['bash', '-c', cmd], start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(camp, 'lancé')
print('id', did)
