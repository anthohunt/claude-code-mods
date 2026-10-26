#!/bin/bash
# Lance N copies (1 à 3) d'une app OpenXR Windows sur le Meta XR Simulator, chacune avec son Operator :
#   J1 -> port 8731, J2 -> 8732, J3 -> 8733.
# Chaque joueur a besoin d'une couche Operator qui écoute sur SON port (la couche officielle est fixée à 8720).
# Ce dépôt ne fournit pas ces couches (voir SKILL.md, « Une couche par port »). Tu donnes, pour chaque joueur,
# le dossier qui contient la couche (XrApiLayer_METAX_operator.json + .dll) dans une variable :
#   COUCHE_8731=... COUCHE_8732=... COUCHE_8733=...
# Jamais 8720 : chaque session Claude ouverte garde un proxy « meta-xr-operator » branché sur 8720, et leur
# flot de requêtes fait planter la couche pendant le démarrage d'Unity (constaté 3 fois sur 3, 0 fois sur un autre port).
# Usage : lancer-joueurs.sh <chemin\App.exe> [nb_joueurs=2] [args passés à l'app, ex. -player est ajouté]
# L'app doit être compilée en Direct3D11 (en D3D12 le Simulator n'affiche que la couleur de fond).
EXE="$1"; N="${2:-2}"; shift 2 2>/dev/null
[ -f "$EXE" ] || { echo "exe introuvable : $EXE"; exit 2; }
# Runtime : XRSIM_DIR s'il est donné (ex. une copie plus récente), sinon la dernière version installée
# (le Simulator se met à jour tout seul).
V="${XRSIM_DIR:-$(ls -d "/c/Program Files/MetaXRSimulator"/v* | sort -V | tail -1)}"
RT="$(cygpath -w "$V/meta_openxr_simulator.json")"; echo "runtime $RT"
NOM="$(basename "$EXE")"
# Aucune copie de l'app ne doit déjà tourner (le script n'en arrête aucune : il ne tue jamais un processus par son nom).
DEJA="$(tasklist //FI "IMAGENAME eq $NOM" 2>/dev/null | grep -ai "$NOM")"
[ -z "$DEJA" ] || { echo "$NOM tourne déjà ; ferme-le (par son PID) puis relance :"; echo "$DEJA"; exit 4; }
cd "$(dirname "$EXE")"
for k in $(seq 1 "$N"); do
  port=$((8730 + k))
  var="COUCHE_$port"; COUCHE="${!var}"
  [ -d "$COUCHE" ] || { echo "variable $var absente ou dossier introuvable (couche Operator du port $port)"; exit 3; }
  COUCHE="$(cygpath -w "$COUCHE")"
  # Controle par le processus qui ECOUTE sur le port (le $! de bash n'est pas l'exe Windows :
  # s'y fier relancait une 2e copie, qui ne peut pas prendre le port et fait planter la couche).
  ecoute() { netstat -ano | grep LISTENING | grep "0\.0\.0\.0:$port " | awk '{print $NF}' | head -1; }
  for essai in 1 2 3; do
    XR_RUNTIME_JSON="$RT" XR_API_LAYER_PATH="$COUCHE" XR_ENABLE_API_LAYERS=XR_APILAYER_METAX_operator       nohup "./$NOM" -player $k "$@" -logFile "$(cygpath -w "$HOME")\joueur$k.log" >/dev/null 2>&1 &
    for i in $(seq 1 30); do [ -n "$(ecoute)" ] && break; sleep 2; done
    sleep 10
    pid=$(ecoute)
    if [ -n "$pid" ] && tasklist //FI "PID eq $pid" | grep -aq "$NOM"; then echo "J$k pret (pid $pid, port $port)"; break; fi
    echo "J$k tombe au demarrage (essai $essai), on relance"
  done
done
