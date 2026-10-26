import type { Tache } from '../types'

// Lit une fiche du registre (format du skill add-autonomous-task).
// Rend null pour un fichier sans en-tete `slug:` (annexes, listes de situations).
export function lireFiche(texte: string, modifieMs: number): Tache | null {
  const lignes = texte.split(/\r?\n/)
  if (lignes[0]?.trim() !== '---') return null
  const fin = lignes.indexOf('---', 1)
  if (fin < 0) return null

  const entete: Record<string, string> = {}
  for (const ligne of lignes.slice(1, fin)) {
    const m = ligne.match(/^([^:]+):\s*(.*)$/)
    if (m?.[1] && m[2] !== undefined) entete[m[1].trim()] = m[2].trim()
  }
  if (!entete.slug) return null

  const criteres: { id: string; coche: boolean }[] = []
  const journal: string[] = []
  let section = ''
  for (const ligne of lignes.slice(fin + 1)) {
    const titre = ligne.match(/^##\s+(.*)$/)
    if (titre) {
      section = (titre[1] ?? "").toLowerCase()
      continue
    }
    if (section.startsWith('crit')) {
      const c = ligne.match(/^- \[( |x|X)\]\s*(C\d+)/)
      if (c?.[2]) criteres.push({ id: c[2], coche: c[1] !== " " })
    } else if (section.startsWith('journal')) {
      const j = ligne.match(/^- (\d{4}-\d{2}-\d{2}.*)$/)
      if (j?.[1]) journal.push(j[1])
    }
  }

  // Les agents ajoutent leurs lignes a la fin : la derniere du fichier est la plus recente.
  const dernier = journal.at(-1) ?? ''

  return {
    slug: entete.slug,
    statut: entete['statut'] ?? '?',
    coches: criteres.filter(c => c.coche).length,
    total: criteres.length,
    criteres,
    dernier,
    modifieMs,
  }
}

const RANG: Record<string, number> = { 'en cours': 0, 'prête': 1, brouillon: 2, 'arrêtée': 3, 'réussie': 4 }

export function trier(taches: Tache[]): Tache[] {
  return [...taches].sort(
    (a, b) => (RANG[a.statut] ?? 5) - (RANG[b.statut] ?? 5) || b.modifieMs - a.modifieMs,
  )
}

export function depuis(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} h`
  return `${Math.round(h / 24)} j`
}

// Ce qui a change entre deux lectures du registre, en phrases courtes.
export function changements(avant: Tache[], apres: Tache[]): string[] {
  const vus = new Map(avant.map(t => [t.slug, t]))
  const notes: string[] = []
  for (const t of apres) {
    const v = vus.get(t.slug)
    if (!v) {
      notes.push(`${t.slug} : nouvelle tâche (${t.statut})`)
      continue
    }
    if (v.statut !== t.statut) notes.push(`${t.slug} : ${v.statut} → ${t.statut}`)
    const dejaCoches = new Set(v.criteres.filter(c => c.coche).map(c => c.id))
    for (const c of t.criteres) {
      if (c.coche && !dejaCoches.has(c.id)) notes.push(`${t.slug} : ${c.id} coché`)
      if (!c.coche && dejaCoches.has(c.id)) notes.push(`${t.slug} : ${c.id} décoché`)
    }
  }

  return notes
}
