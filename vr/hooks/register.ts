import type { EngineInterface, Register } from 'claude-code'

// Mode VR : tant qu'il est actif, les regles de travail VR entrent dans chaque prompt.
// Interrupteur = ~/.claude/vr-mode.flag, un par machine (tous les comptes Claude le voient).
// Contenu "off" = inactif ; fichier absent = inactif ; autre contenu (la date d'activation) = actif.
//
// Pourquoi un mode impose et pas une regle ecrite : une consigne « verifier comme l’utilisateur » dans un
// fichier de regles se respecte a la lettre en violant son intention (lire des etats de composants pour
// statuer sur un symptome visuel). Une regle declarative se rationalise ; un rappel injecte a chaque message, non.

export const RAPPEL = [
  'MODE VR ACTIF — exigences non negociables :',
  '',
  '1. LA DOCUMENTATION AVANT LE CODE',
  '   Avant de cabler, configurer, inventer un composant ou AFFIRMER un',
  '   comportement du SDK : chercher dans la documentation officielle Meta Horizon',
  '   (developers.meta.com/horizon/documentation), de preference via un index local',
  '   (voir le README du mod), puis lire la page trouvee avec une question precise.',
  '   Le declencheur n\'est PAS le doute. Se sentir sur est justement l\'etat ou',
  '   l\'on ne verifie pas, donc celui ou l\'on se trompe sans le voir.',
  '   Avant d\'ecrire un composant : « Meta fournit-il deja ca ? » se tranche par',
  '   une recherche, jamais par intuition (un composant ecrit a la main existe',
  '   souvent deja, mieux fait, dans le SDK).',
  '',
  '2. LES DEUX OUTILS, CHACUN A SA PLACE',
  '   unity-mcp        = REPARER. execute_code (C# editeur), prefabs, scenes,',
  '                      manage_editor play/stop, manage_camera screenshot.',
  '   meta-xr-operator = CONSTATER. Agit en joueur dans l\'app qui tourne :',
  '                      set_controller_pose / set_controller_input /',
  '                      set_head_pose, et capture_composited_image = l\'image',
  '                      telle qu\'elle est rendue.',
  '                      Hors ligne ? `metavr xroperator enable` puis Play.',
  '   La boucle complete : reparer (unity-mcp) -> Play -> jouer le scenario et',
  '   REGARDER (operator) -> corriger. Reparer sans constater ne vaut rien.',
  '',
  '3. LA PREUVE A LE TYPE DU SYMPTOME',
  '   Symptome visuel => la cloture exige une IMAGE. Jamais un etat de',
  '   composant, jamais un booleen, jamais un compteur d\'objets.',
  '   Verbes autorises : « modifie » (j\'ai ecrit du code) / « constate » (j\'ai',
  '   produit et lu l\'artefact du bon type) / « confirme » (l’utilisateur l\'a vu).',
  '   Interdit d\'ecrire « corrige » ou « verifie » sans artefact joint.',
  '',
  '4. TOUJOURS SORTIR DU PLAY APRES UN TEST',
  '   Un Play laisse tourner monopolise l\'editeur, garde le casque en session,',
  '   et fait perdre a la sortie toute modification faite pendant. Enchainer',
  '   systematiquement : play -> observer -> `manage_editor stop`. Meme si un',
  '   autre test suit : on relance, on ne laisse pas courir.',
  '   Red flag : je m\'appretais a repondre a l’utilisateur alors que le Play tourne',
  '   encore -> stop AVANT de repondre.',
  '',
  '5. MULTIJOUEUR : UN OPERATOR PAR JOUEUR, MONTAGE SELON LES CASQUES (`adb devices`)',
  '   2 casques -> APK sur chacun, adb -s <serie> forward tcp:8721 / tcp:8722 -> tcp:8720.',
  '   1 casque  -> J1 = Editor/exe + Simulator (8720), J2 = APK casque (forward 8721).',
  '   0 casque  -> 2 exe sur le Simulator (lancer-joueurs.sh ; un port d\'Operator par',
  '                joueur, app en D3D11). MCP : meta-xr-operator (J1), meta-xr-operator-j2 (J2).',
  '   Detail, outils et pieges : skill vr:multijoueur.',
].join('\n')

const PROXY_REL = '/metavr/tools/meta-xr-operator/meta-xr-operator-standalone-public/windows/meta-xr-operator-mcp-proxy.exe'

async function flagPath($: EngineInterface): Promise<string | undefined> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  return home ? `${home}/.claude/vr-mode.flag` : undefined
}

export async function isOn($: EngineInterface): Promise<boolean> {
  const p = await flagPath($)
  if (!p || !(await $.fs.exists(p))) return false
  return (await $.fs.read(p)).trim() !== 'off'
}

async function setMode($: EngineInterface, on: boolean): Promise<void> {
  const p = await flagPath($)
  if (p) await $.fs.write(p, on ? new Date().toISOString() : 'off')
  $.ui.status(on ? 'Mode : VR' : undefined)
}

// Les deux Operators (J1 = port 8720, J2 = 8721) se declarent une fois par compte, et seulement sur un ordi
// Windows qui a le proxy officiel de Meta : ailleurs (VPS, tour) il n'y a pas d'app XR. Un poste d'agents
// equipe du proxy a ainsi les memes MCP que le laptop, sans geste a la main.
const OPERATORS: Array<[string, string[]]> = [
  ['meta-xr-operator', []],
  ['meta-xr-operator-j2', ['http://127.0.0.1:8721']],
]

async function ensureOperators($: EngineInterface): Promise<void> {
  if ((await $.store.get('operatorsDeclared')) === true) return
  const appdata = await $.env.get('APPDATA')
  if (!appdata) return
  const proxy = (appdata + PROXY_REL).replace(/\//g, '\\')
  if (!(await $.fs.exists(proxy))) return
  let ok = true
  for (const [name, args] of OPERATORS) {
    const r = await $.process.run(['claude', 'mcp', 'add', name, '-s', 'user', '--', proxy, ...args], { timeoutMs: 60000 })
    // Deja present : la commande echoue avec « already exists », c'est le resultat voulu.
    if (r.exitCode !== 0 && !/already exists/i.test(r.stderr + r.stdout)) ok = false
  }
  if (ok) await $.store.set('operatorsDeclared', true)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'vr',
      description: 'Active, coupe ou montre le mode VR (persistant, pour toute la machine)',
      argumentHint: '[on|off|status]',
      immediate: true,
    })
    if (await isOn($)) $.ui.status('Mode : VR')
    try { await ensureOperators($) } catch { /* jamais bloquant pour la session */ }
    return next(e)
  })

  on('command.run', { command: 'vr' }, async ($, e) => {
    const arg = (e.args ?? '').trim().toLowerCase()
    const current = await isOn($)
    if (arg === 'status') return { text: `Mode VR ${current ? 'actif' : 'inactif'}.` }
    const wanted = arg === 'on' ? true : arg === 'off' ? false : !current
    await setMode($, wanted)
    return { text: `Mode VR ${wanted ? 'active' : 'desactive'} (pris en compte des le prochain message).` }
  })

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (!(await isOn($))) return result
    return { sections: [...result.sections, { id: 'vr:rappel', text: RAPPEL, scope: 'session' as const }] }
  })
}
