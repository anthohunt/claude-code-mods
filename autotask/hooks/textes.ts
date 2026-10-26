import type { AutotaskV2Conformite, AutotaskV2Ligne, AutotaskV2Mission, AutotaskV2Resultat, AutotaskV2Tache } from '../types'
import { toutesTaches } from './mission'

export type Resultats = Record<string, AutotaskV2Resultat | undefined>

const echapper = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Pour comparer un fait : minuscules, sans guillemets ni gras, espaces réduits, nombres remplacés par « # » (ils bougent d'une seconde à l'autre). */
export const normaliser = (s: string) =>
  s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[«»“”"'’`*]/g, ' ')
    .replace(/\d+(?:[.,]\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()

/** Le contenu de la ligne « cle : … » de la réponse (markdown de tête et gras ignorés), ou undefined. */
export function ligneDe(reponse: string, cle: string, cles: readonly string[] = [cle]): string | undefined {
  // Une clé ouvre un bloc : « Clé : … » sur sa ligne, ou « Clé » seule en titre, puis les lignes suivantes
  // jusqu'à la clé suivante (réponse aérée, une tâche par ligne).
  const net = (brute: string) =>
    brute
      .replace(/\*\*|__/g, '')
      .replace(/^\s*(?:[-*•>]|#{1,6}|\d+[.)])\s+/, '')
      .trim()
  const tete = (c: string) => new RegExp(`^${echapper(c)}\\s*(?::\\s*(.*))?$`, 'iu')
  const lignes = reponse.split('\n').map(net)
  for (let i = 0; i < lignes.length; i++) {
    const m = tete(cle).exec(lignes[i] ?? '')
    if (!m) continue
    const bloc = [(m[1] ?? '').trim()]
    for (let j = i + 1; j < lignes.length; j++) {
      const l = lignes[j] ?? ''
      if (cles.some(c => c.toLowerCase() !== cle.toLowerCase() && tete(c).test(l))) break
      if (l) bloc.push(l)
    }

    return bloc.filter(Boolean).join('\n').trim()
  }

  return undefined
}

export function marquesDe(zone: string, id: string): Array<'✓' | '✗'> {
  const re = new RegExp(`([✓✗])\\s*(?:\\*\\*|\`|\\[)?${echapper(id)}(?![\\w-])`, 'gu')

  return [...zone.matchAll(re)].map(m => m[1] as '✓' | '✗')
}

/** Une ligne de format telle que montrée au modèle. */
const ligneFormat = (l: AutotaskV2Ligne) => `${l.cle} : ${l.modele}`

export function blocFormat(m: AutotaskV2Mission): string {
  // Réponse aérée : clé en gras, une tâche par ligne sous son titre, une ligne vide entre les blocs.
  const blocs = m.reponse.map(x => {
    if (x.taches) {
      const ids = (x.taches === 'monitoring' ? m.monitoring : m.surveillance).map(t => t.id)

      return [`**${x.cle}**`, ...ids.map(id => `✓/✗ **${id}** <fait mesuré du script>`)].join('\n')
    }

    return `**${x.cle}** : ${x.modele}${x.motif ? `   ← doit vérifier /${x.motif}/` : ''}`
  })

  return ['```', blocs.join('\n\n'), '```'].join('\n')
}

const regles = (m: AutotaskV2Mission) =>
  [
    'Règles que le mod vérifie à la fin de ton tour (il relance lui-même tous les scripts) :',
    '- chaque bloc du format ci-dessous, sa clé en gras ; sous Monitoring et Surveillance, une tâche par ligne ; une ligne vide entre les blocs ;',
    '- pour chaque tâche, écris « ✓ <id> » si son script dit OK, « ✗ <id> » s’il dit KO — jamais ✓ quand le script dit KO ;',
    '- juste après la marque, recopie le fait mesuré du script (sa dernière ligne, sans OK/KO), tel quel ;',
    '- un script KO n’est pas une réponse : fais ce que dit « si KO » jusqu’à ce que le script dise OK.',
    '',
    'Format exact à reproduire :',
    blocFormat(m),
  ].join('\n')

const blocTache = (t: AutotaskV2Tache, n: number, r: Resultats) =>
  [`${n}. [${t.id}] ${t.titre}`, `   attendu : ${t.attendu}`, `   script : \`${t.controle}\``, `   si KO : ${t.si_ko}`, ...(r[t.id] ? [`   dernier contrôle : ${r[t.id]?.ligne}`] : [])].join('\n')

const blocArrets = (m: AutotaskV2Mission, r: Resultats, dossier: string) => [
  ...m.arret.map(a => `- [${a.id}] ${a.texte} — \`${a.controle}\` : ${r[a.id] ? r[a.id]?.ligne : 'pas encore contrôlé'}`),
  `- [STOP] fichier ${dossier}/STOP : absent`,
]

/** Le message de réveil d'un passage, construit depuis mission.json et les derniers résultats. */
export function messageReveil(a: { mission: AutotaskV2Mission; dossier: string; ref: string; heure: string; resultats: Resultats }): string {
  const { mission: m, resultats: r } = a
  let n = 0

  return [
    `[autotask] ${m.titre} — passage de ${a.heure}`,
    `réf. ${a.ref}`,
    '',
    `Mission : ${m.mission}`,
    `Dossier : ${a.dossier} (les scripts se lancent depuis ce dossier)`,
    '',
    `Critères d'arrêt (contrôlés à ${a.heure}, aucun n'est atteint) :`,
    ...blocArrets(m, r, a.dossier),
    '',
    'Monitoring :',
    ...(m.monitoring.length ? m.monitoring.map(t => blocTache(t, ++n, r)) : ['(aucune tâche)']),
    '',
    'Surveillance :',
    ...(m.surveillance.length ? m.surveillance.map(t => blocTache(t, ++n, r)) : ['(aucune tâche)']),
    '',
    regles(m),
  ].join('\n')
}

/** Vérifie la réponse finale d'un tour contre le format et les résultats des scripts (aucun modèle : comparaison de texte). */
export function verifierReponse(m: AutotaskV2Mission, reponse: string, r: Resultats): AutotaskV2Conformite {
  const manques: string[] = []
  const zones: Partial<Record<'monitoring' | 'surveillance', string>> = {}

  for (const l of m.reponse) {
    const contenu = ligneDe(reponse, l.cle, m.reponse.map(x => x.cle))
    if (contenu === undefined) {
      manques.push(`ligne « ${l.cle} : … » absente`)
      continue
    }
    if (contenu === '') manques.push(`ligne « ${l.cle} » vide`)
    else if (l.motif && !new RegExp(l.motif, 'u').test(contenu)) manques.push(`ligne « ${l.cle} » hors format (attendu : ${l.modele}) ; écrit : « ${contenu.slice(0, 160)} »`)
    if (l.taches) zones[l.taches] = `${zones[l.taches] ?? ''}\n${contenu}`
  }

  for (const t of toutesTaches(m)) {
    const res = r[t.id]
    const zone = zones[t.section] ?? reponse
    const ou = zones[t.section] !== undefined ? `dans la ligne de ${t.section}` : 'dans la réponse'
    const marques = marquesDe(zone, t.id)
    const attendue = res?.ok ? '✓' : '✗'
    if (marques.length === 0) {
      manques.push(`[${t.id}] marque absente ${ou} : écris « ${attendue} ${t.id} ${res?.fait ?? ''} »`.trimEnd())
      continue
    }
    if (marques.some(x => x !== attendue))
      manques.push(`[${t.id}] ta réponse marque ${marques.join('/')} alors que le script dit « ${res?.ligne ?? 'KO pas de résultat'} »${attendue === '✗' ? ' (✓ seulement si OK)' : ''}`)
    if (res?.fait && !normaliser(zone).includes(normaliser(res.fait))) manques.push(`[${t.id}] fait mesuré non repris : « ${res.fait} »`)
  }

  return { conforme: manques.length === 0, manques }
}

/** Les tâches dont le script dit KO. */
export const tachesKo = (m: AutotaskV2Mission, r: Resultats) => toutesTaches(m).filter(t => !r[t.id]?.ok)

/** Le message de reprise : exactement ce qui manque, tâche par tâche, avec la sortie du script et son si_ko. */
export function messageReprise(a: { mission: AutotaskV2Mission; dossier: string; ref: string; heurePassage: string; heure: string; n: number; max: number; resultats: Resultats; conformite: AutotaskV2Conformite }): string {
  const { mission: m, resultats: r } = a
  const ko = tachesKo(m, r)

  return [
    `[autotask] ${m.titre} — reprise ${a.n}/${a.max} du passage de ${a.heurePassage}`,
    `réf. ${a.ref}`,
    '',
    `Le mod a relancé tous les scripts à ${a.heure}. Ce n'est pas fini :`,
    ...(ko.length
      ? ['', 'Scripts KO — agis jusqu’à ce que chacun dise OK :', ...ko.map(t => `- [${t.id}] ${t.titre}\n  sortie : ${r[t.id]?.ligne ?? 'KO pas de résultat'}\n  script : \`${t.controle}\`\n  si KO : ${t.si_ko}`)]
      : []),
    ...(a.conformite.manques.length ? ['', 'Ta réponse :', ...a.conformite.manques.map(x => `- ${x}`)] : []),
    '',
    'Agis maintenant (ne te contente pas de répondre) : relance chaque script KO après ton action, jusqu’au OK. Puis réponds de nouveau, en entier, dans le format exact.',
    '',
    regles(m),
  ].join('\n')
}

/** Le dernier message : la mission s'arrête, compte rendu demandé (pas vérifié, pas de reprise). */
export function messageArret(a: { mission: AutotaskV2Mission; statut: 'accomplie' | 'arretee'; cause: string; ligne?: string; heure: string; resultats: Resultats }): string {
  const { mission: m, resultats: r } = a

  return [
    `[autotask] ${m.titre} — mission ${a.statut === 'accomplie' ? 'accomplie' : 'arrêtée'} (${a.heure})`,
    '',
    `Mission : ${m.mission}`,
    `Arrêt : ${a.cause}${a.ligne ? ` — script : « ${a.ligne} »` : ''}`,
    'Plus aucun passage ne sera lancé.',
    '',
    'Derniers contrôles :',
    ...toutesTaches(m).map(t => `- ${r[t.id] ? (r[t.id]?.ok ? '✓' : '✗') : '·'} ${t.id} ${r[t.id]?.ligne ?? 'pas contrôlé'}`),
    '',
    'Écris ton compte rendu final, dans ce format :',
    blocFormat(m),
  ].join('\n')
}

