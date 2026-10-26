import type { AutotaskV2Arret, AutotaskV2Ligne, AutotaskV2Mission, AutotaskV2Tache } from '../types'

export type Validation = { ok: true; mission: AutotaskV2Mission } | { ok: false; erreurs: string[] }

const CLES_MISSION = ['titre', 'mission', 'frequence', 'arret', 'monitoring', 'surveillance', 'reponse']
const CLES_ARRET = ['id', 'texte', 'controle', 'issue']
const CLES_TACHE = ['id', 'titre', 'attendu', 'controle', 'si_ko']
const CLES_LIGNE = ['cle', 'modele', 'taches', 'motif']
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/

type Objet = Record<string, unknown>
const estObjet = (v: unknown): v is Objet => typeof v === 'object' && v !== null && !Array.isArray(v)
const texte = (v: unknown) => typeof v === 'string' && v.trim() !== ''

/** Valide le texte de mission.json : tout champ manquant, vide, inconnu ou mal typé est une erreur nommée. */
export function validerMission(source: string): Validation {
  let brut: unknown
  try {
    brut = JSON.parse(source)
  } catch (err) {
    return { ok: false, erreurs: [`JSON illisible : ${err instanceof Error ? err.message : String(err)}`] }
  }
  if (!estObjet(brut)) return { ok: false, erreurs: ['la racine doit être un objet JSON'] }

  const erreurs: string[] = []
  for (const k of Object.keys(brut)) if (!CLES_MISSION.includes(k)) erreurs.push(`champ inconnu « ${k} »`)
  for (const k of ['titre', 'mission']) if (!texte(brut[k])) erreurs.push(`« ${k} » : texte non vide attendu`)

  const f = brut.frequence
  if (!Array.isArray(f) || f.length === 0) erreurs.push('« frequence » : liste non vide de minutes (0 à 59) attendue')
  else {
    for (const m of f) if (!Number.isInteger(m) || (m as number) < 0 || (m as number) > 59) erreurs.push(`« frequence » : ${JSON.stringify(m)} n'est pas une minute 0 à 59`)
    if (new Set(f).size !== f.length) erreurs.push('« frequence » : minute en double')
  }

  const ids = new Set<string>()
  const voirId = (ou: string, v: unknown) => {
    if (typeof v !== 'string' || !ID.test(v)) erreurs.push(`${ou} : « id » attendu (lettres, chiffres, _ ou -, 40 au plus)`)
    else if (ids.has(v)) erreurs.push(`${ou} : id « ${v} » en double`)
    else ids.add(v)
  }
  const liste = (k: string, vide: boolean): unknown[] => {
    const v = brut[k]
    if (!Array.isArray(v)) {
      erreurs.push(`« ${k} » : liste attendue`)
      return []
    }
    if (!vide && v.length === 0) erreurs.push(`« ${k} » : au moins un élément`)
    return v
  }
  const champs = (ou: string, o: unknown, permis: string[], requis: string[]): o is Objet => {
    if (!estObjet(o)) {
      erreurs.push(`${ou} : objet attendu`)
      return false
    }
    for (const k of Object.keys(o)) if (!permis.includes(k)) erreurs.push(`${ou} : champ inconnu « ${k} »`)
    for (const k of requis) if (k !== 'id' && !texte(o[k])) erreurs.push(`${ou} : « ${k} » texte non vide attendu`)
    return true
  }

  liste('arret', true).forEach((a, i) => {
    const ou = `arret[${i}]`
    if (!champs(ou, a, CLES_ARRET, ['id', 'texte', 'controle'])) return
    voirId(ou, a.id)
    if (a.issue !== undefined && a.issue !== 'accomplie' && a.issue !== 'arretee') erreurs.push(`${ou} : « issue » vaut « accomplie » ou « arretee »`)
  })
  for (const section of ['monitoring', 'surveillance'])
    liste(section, true).forEach((t, i) => {
      const ou = `${section}[${i}]`
      if (champs(ou, t, CLES_TACHE, CLES_TACHE)) voirId(ou, t.id)
    })
  const cles = new Set<string>()
  liste('reponse', false).forEach((l, i) => {
    const ou = `reponse[${i}]`
    if (!champs(ou, l, CLES_LIGNE, ['cle', 'modele'])) return
    if (typeof l.cle === 'string') {
      if (/[:\n]/.test(l.cle)) erreurs.push(`${ou} : « cle » sans « : » ni retour à la ligne`)
      if (cles.has(l.cle.toLowerCase())) erreurs.push(`${ou} : clé « ${l.cle} » en double`)
      cles.add(l.cle.toLowerCase())
    }
    if (l.taches !== undefined && l.taches !== 'monitoring' && l.taches !== 'surveillance') erreurs.push(`${ou} : « taches » vaut « monitoring » ou « surveillance »`)
    if (l.motif !== undefined) {
      if (typeof l.motif !== 'string') erreurs.push(`${ou} : « motif » texte attendu`)
      else
        try {
          new RegExp(l.motif, 'u')
        } catch {
          erreurs.push(`${ou} : « motif » n'est pas une expression régulière valide`)
        }
    }
  })
  if (erreurs.length > 0) return { ok: false, erreurs }

  const b = brut as Objet
  const net = (s: unknown) => String(s).trim()
  const mission: AutotaskV2Mission = {
    titre: net(b.titre),
    mission: net(b.mission),
    frequence: [...(b.frequence as number[])].sort((x, y) => x - y),
    arret: (b.arret as Objet[]).map(a => ({ id: net(a.id), texte: net(a.texte), controle: net(a.controle), ...(a.issue ? { issue: a.issue as AutotaskV2Arret['issue'] } : {}) })),
    monitoring: (b.monitoring as Objet[]).map(tache),
    surveillance: (b.surveillance as Objet[]).map(tache),
    reponse: (b.reponse as Objet[]).map(
      (l): AutotaskV2Ligne => ({ cle: net(l.cle), modele: net(l.modele), ...(l.taches ? { taches: l.taches as AutotaskV2Ligne['taches'] } : {}), ...(l.motif !== undefined ? { motif: String(l.motif) } : {}) }),
    ),
  }

  return { ok: true, mission }
}

const tache = (t: Objet): AutotaskV2Tache => ({ id: String(t.id).trim(), titre: String(t.titre).trim(), attendu: String(t.attendu).trim(), controle: String(t.controle).trim(), si_ko: String(t.si_ko).trim() })

/** Le premier mot d'un contrôle, résolu dans le dossier de la mission : le fichier qui doit exister (undefined pour une commande du PATH). */
export function executable(controle: string, dossier: string): string | undefined {
  const premier = controle.trim().split(/\s+/)[0] ?? ''
  if (!premier.includes('/')) return undefined

  return premier.startsWith('/') ? premier : `${dossier}/${premier.replace(/^\.\//, '')}`
}

/** Toutes les tâches à contrôler en fin de tour, avec leur section. */
export function toutesTaches(m: AutotaskV2Mission): Array<AutotaskV2Tache & { section: 'monitoring' | 'surveillance' }> {
  return [...m.monitoring.map(t => ({ ...t, section: 'monitoring' as const })), ...m.surveillance.map(t => ({ ...t, section: 'surveillance' as const }))]
}
