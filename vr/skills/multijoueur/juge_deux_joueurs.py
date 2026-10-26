"""Juge du test à deux joueurs : renvoie 0 (PASS) ou 1 (FAIL).

Deux joueurs tournent, chacun avec son Operator (--ports, par défaut 8731,8732 ; --casque 2 si J2 est un casque).
1. Une image par joueur : elles doivent être différentes (fond bleu chez J1, orange chez J2).
2. On lève la manette droite (cube rouge) de J1 seulement : le cube monte chez J1 et ne bouge pas chez J2.
3. Puis l'inverse avec J2.
Les images sont gardées dans ~/meta-xr-operator-preuves/ pour la relecture humaine.
"""
import base64, io, json, os, shutil, subprocess, sys, tempfile, time
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from operator_client import OperatorClient

OUT = os.path.join(os.path.expanduser("~"), "meta-xr-operator-preuves")
os.makedirs(OUT, exist_ok=True)
BAS, HAUT = [0.15, -0.20, -0.5], [0.15, 0.12, -0.5]


# Joueurs sur casque (--casque 2) : l'image vient de `adb exec-out screencap` (oeil gauche), car la capture
# de l'Operator exige un consentement dans le casque a chaque lancement de l'app, et `metavr capture`
# embarque un autre adb qui redemarre le serveur adb et efface les renvois de port.
CASQUES = {int(a) for a in sys.argv[sys.argv.index("--casque") + 1].split(",")} if "--casque" in sys.argv else set()


def capture_casque(c, nom):
    raw = subprocess.run(["adb", "exec-out", "screencap", "-p"], check=True, capture_output=True, timeout=60).stdout
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    im = im.crop((0, 0, im.width // 2, im.height))  # oeil gauche
    im.save(os.path.join(OUT, nom + ".png"))
    return im


def capture(c, nom):
    print("  capture", nom, flush=True)
    if getattr(c, "joueur", None) in CASQUES:
        return capture_casque(c, nom)
    # Une app qui vient de démarrer rend parfois une image noire : on reprend, et on le dit.
    for essai in range(1, 6):
        r = c.tool("openxr_capture_composited_image", eye="left")
        img = next((i for i in r["content"] if i["type"] == "image"), None)
        if img is None:  # l'Operator a repondu par un message (consentement, capture indisponible...) : le montrer
            raise RuntimeError(f"pas d'image pour {nom} : " + " ".join(i.get("text", "") for i in r["content"])[:400])
        raw = base64.b64decode(img["data"])
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        if sum(im.getpixel((5, 5))) > 150:
            break
        print(f"  image noire pour {nom}, essai {essai}", flush=True)
        time.sleep(2)
    open(os.path.join(OUT, nom + ".png"), "wb").write(raw)
    return im


def cube_rouge(im):
    """Hauteur moyenne (0 = haut de l'image) des pixels rouges, et leur nombre."""
    im = im.resize((im.width // 4, im.height // 4))
    ys = [y for y in range(im.height) for x in range(im.width)
          if (lambda p: p[0] > 180 and p[1] < 125 and p[2] < 125 and p[0] - p[1] > 100)(im.getpixel((x, y)))]
    return (sum(ys) / len(ys) if ys else None), len(ys)


def fond(im):
    return im.getpixel((5, 5))


def poser(c, droite):
    print("  pose J%s" % getattr(c, "joueur", "?"), flush=True)
    try:  # sur un vrai casque la tete suit le casque : l'outil refuse, et les manettes en espace « view » suffisent
        c.tool("openxr_set_head_pose", position=[0, 1.6, 0], orientation=[0, 0, 0, 1], base_space="local_floor")
    except RuntimeError:
        pass
    c.tool("openxr_set_controller_pose", hand="left", position=[-0.15, -0.2, -0.5], orientation=[0, 0, 0, 1], base_space="view")
    c.tool("openxr_set_controller_pose", hand="right", position=droite, orientation=[0, 0, 0, 1], base_space="view")


def main():
    # --ports J1,J2 : ports des Operators (Simulator : 8731, 8732 ; casque : port de l'adb forward, ex. 8721)
    ports = [int(x) for x in sys.argv[sys.argv.index("--ports") + 1].split(",")] if "--ports" in sys.argv else [8731, 8732]
    j = {1: OperatorClient(ports[0]), 2: OperatorClient(ports[1])}
    for k, c in j.items():
        c.joueur, c.port = k, ports[k - 1]
    verdicts = []
    try:
        for k, c in j.items():  # chauffe : la 1re image d'une app qui démarre peut être noire
            poser(c, BAS)
            capture(c, f"chauffe-J{k}")
        time.sleep(3)
        a = {k: capture(c, f"0-J{k}-depart") for k, c in j.items()}
        f1, f2 = fond(a[1]), fond(a[2])
        differentes = f1 != f2
        verdicts.append(("images différentes", differentes, f"fond J1={f1} J2={f2}"))
        y0 = {k: cube_rouge(a[k]) for k in j}
        verdicts.append(("cube rouge visible chez les deux", all(y0[k][1] > 20 for k in j), str(y0)))

        for leve, autre in ((1, 2), (2, 1)):
            for c in j.values():
                poser(c, BAS)
            time.sleep(1)
            avant = {k: cube_rouge(capture(j[k], f"{leve}-avant-J{k}")) for k in j}
            j[leve].tool("openxr_set_controller_pose", hand="right", position=HAUT, orientation=[0, 0, 0, 1], base_space="view")
            time.sleep(1)
            apres = {k: cube_rouge(capture(j[k], f"{leve}-apres-J{k}")) for k in j}
            monte = avant[leve][0] is not None and apres[leve][0] is not None and apres[leve][0] < avant[leve][0] - 10
            immobile = avant[autre][0] is not None and apres[autre][0] is not None and abs(apres[autre][0] - avant[autre][0]) < (20 if autre in CASQUES else 3)  # un vrai casque dérive un peu
            verdicts.append((f"J{leve} levée : le cube monte chez J{leve}", monte, f"{avant[leve]} -> {apres[leve]}"))
            verdicts.append((f"J{leve} levée : rien ne bouge chez J{autre}", immobile, f"{avant[autre]} -> {apres[autre]}"))
    finally:
        for c in j.values():
            c.close()
    ok = all(v[1] for v in verdicts)
    for nom, res, det in verdicts:
        print(("PASS " if res else "FAIL ") + nom + "  [" + det + "]")
    print("VERDICT", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
