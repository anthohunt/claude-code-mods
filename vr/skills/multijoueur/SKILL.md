---
name: multijoueur
description: Tester une app VR Unity/Meta Quest en multijoueur avec un Meta XR Operator par joueur — choisir le montage selon les casques branches (2, 1 ou 0), lancer les joueurs, les piloter et les comparer par images. Declencheurs — "teste en multijoueur", "deux joueurs", "lance deux instances", "test multi sans casque", "un operator par joueur", "/vr:multijoueur". Fait partie du mod vr (le mode VR se bascule par /vr).
---

# vr:multijoueur — un Meta XR Operator par joueur

Le mode VR lui-meme (rappel injecte a chaque prompt) se bascule par la commande `/vr`
(`/vr on`, `/vr off`, `/vr status`). Interrupteur : `~/.claude/vr-mode.flag`, un par machine.
Ce skill ne couvre que le multijoueur. Les outils sont a cote de ce fichier, dans le dossier du mod
(`<dossier des mods>\vr\skills\multijoueur\`). Prerequis Windows : XR Simulator, couche Operator dans
`%APPDATA%\metavr\tools\meta-xr-operator\`, Python avec Pillow, une app OpenXR compilee en Direct3D11.

## Tester le multijoueur : la regle des casques 

Chaque joueur a son propre Meta XR Operator. Choisir le montage selon les casques branches
(`adb devices`), dans cet ordre de priorite :

| Casques branches | Joueur 1 | Joueur 2 | Etat |
|---|---|---|---|
| **2** | APK sur le casque A : `adb -s <serieA> forward tcp:8721 tcp:8720` | APK sur le casque B : `adb -s <serieB> forward tcp:8722 tcp:8720` | documente par Meta, pas encore essaye |
| **1** | exe + XR Simulator, port 8731 (`lancer-joueurs.sh <exe> 1`) | APK sur le casque : `adb forward tcp:8721 tcp:8720` | **constate** (juge PASS, Quest 3) |
| **0** (poste sans casque, integration continue) | exe + Simulator, une couche par port, 8731 | exe + Simulator, une couche par port, 8732 | **constate** (juge PASS) |

Cote Claude, un MCP par joueur, tous sur le proxy officiel avec l'adresse en 1er argument :
`meta-xr-operator` (8720) et `meta-xr-operator-j2` (8721) ; le mod declare les deux tout seul sur chaque ordi Windows qui a le proxy Meta. Pour un 3e joueur,
il faut ajouter `claude mcp add meta-xr-operator-j3 -s user -- <proxy.exe> http://127.0.0.1:8722`.
Les nouveaux MCP n'apparaissent qu'apres le redemarrage de Claude.

Casque (doc Meta « Using Meta XR Operator with Meta Quest ») : Development Build, permission
Internet, `<uses-feature android:name="com.oculus.experimental.enabled" android:required="false"/>`,
`adb shell setprop debug.oculus.experimentalEnabled 1`, `adb shell am broadcast -a
com.oculus.vrpowermanager.prox_close` (casque pose sur la table). Sur casque, l'agent ne peut
PAS bouger la tete ; manettes, mains et captures restent pilotables.

### Outils (dossier de ce skill)
- `lancer-joueurs.sh <App.exe> [2|3]` : lance les copies sur le Simulator (derniere version
  installee), J1 sur 8731, J2 sur 8732, J3 sur 8733 (variables `COUCHE_8731`, etc., voir plus bas). Il relance une copie qui tombe au
  demarrage (cette course est connue).
- `operator_client.py` : pilote un Operator par le proxy officiel depuis un script.
- `juge_deux_joueurs.py` : exemple de test croise. On leve la manette d'un joueur, puis on
  verifie sur les images qu'elle bouge chez lui et pas chez l'autre. Les images vont dans
  `~/meta-xr-operator-preuves/`.

### Une couche par port (non fournie)
La couche Operator officielle (`XrApiLayer_METAX_operator.dll`) ecoute sur le port 8720, fixe. Deux joueurs sur
le meme ordi ont donc besoin chacun d'une copie de la couche qui ecoute sur un autre port. **Ce depot ne fournit
pas l'outil qui fabrique ces copies** : il modifierait un binaire de Meta, et la licence du SDK Meta n'a pas ete
verifiee pour sa redistribution. Si tu le fais toi-meme, relis d'abord les conditions de Meta. Le lanceur
attend simplement, pour chaque port, le dossier d'une couche qui y ecoute (`COUCHE_8731=...`).

### Pieges constates
- **Jamais le port 8720 pour un joueur du Simulator** : chaque session Claude ouverte garde un proxy
  `meta-xr-operator` branche dessus, et leur flot de requetes fait planter la couche au demarrage
  d'Unity. Le lanceur prend 8731, 8732, 8733. Le juge : `--ports 8731,8732` (ou `8731,8721` avec un casque).
- **Casque : ne pas utiliser `metavr capture screenshot` pendant un test** : il embarque un autre adb,
  qui redemarre le serveur et efface les `adb forward`. Le juge capture par `adb exec-out screencap`
  (oeil gauche).
- **Casque : la capture de l'Operator demande un consentement a CHAQUE lancement de l'app**
  (`appops` ne le contourne pas). L'image du casque passe donc par `adb exec-out screencap`
  (option `--casque 2` du juge). Laisser `debug.meta_xr_operator.request_capture_permission` a 0,
  sinon le dialogue bloque les lancements suivants.
- **Casque sans manettes allumees** : il faut declarer le suivi des mains dans le manifeste, sinon
  Horizon OS bloque le lancement (« manettes requises »).
- **App en Direct3D11 obligatoire.** En D3D12, le Simulator n'affiche que la couleur de fond.
- **Le Simulator se met a jour tout seul** (v207.0 -> v207.1 en plein test, ce qui a coupe un
  joueur). Le lanceur prend donc toujours la derniere version.
- Les 2 joueurs en Unity Editor + clone (Multiplayer Play Mode / ParrelSync) n'ont pas ete
  essayes : seul le montage avec 2 exe l'a ete.
- **Une autre app peut reprendre le premier plan du casque** (c'est arrive) : verifier
  `adb shell dumpsys activity activities | grep -m1 topResumedActivity` avant le juge.
- La premiere image d'une app qui vient de demarrer peut etre noire : reprendre la capture.

