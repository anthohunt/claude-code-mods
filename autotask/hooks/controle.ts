import type { AutotaskV2Resultat } from '../types'

export type Sortie = { exitCode: number; stdout: string; stderr: string }

const derniere = (t: string) =>
  t
    .split('\n')
    .map(l => l.trim())
    .filter(l => l !== '')
    .at(-1) ?? ''

const court = (t: string, n = 300) => (t.length > n ? `${t.slice(0, n - 1)}…` : t)

/**
 * Lit la sortie d'un script de contrôle : sa dernière ligne non vide doit commencer par OK ou KO, suivie du fait mesuré.
 * OK seulement si la ligne commence par OK ET le code de sortie est 0 ; tout le reste est KO.
 */
export function lireSortie(s: Sortie): Pick<AutotaskV2Resultat, 'ok' | 'ligne' | 'fait' | 'code'> {
  const ligne = court(derniere(s.stdout))
  const tete = /^(OK|KO)(?=$|[\s:·—,.-])\s*[:·—,.-]?\s*/.exec(ligne)
  if (!tete) {
    const err = derniere(s.stderr)
    const fait = `le script n'a pas dit OK/KO (code ${s.exitCode})${err ? ` : ${court(err, 200)}` : ligne ? ` : ${ligne}` : ''}`

    return { ok: false, ligne: `KO ${fait}`, fait, code: s.exitCode }
  }
  const fait = ligne.slice(tete[0].length).trim()
  if (tete[1] === 'OK' && s.exitCode !== 0) return { ok: false, ligne: `KO (code de sortie ${s.exitCode}) ${ligne}`, fait, code: s.exitCode }

  return { ok: tete[1] === 'OK', ligne, fait, code: s.exitCode }
}

/** Un script qui n'a pas pu tourner jusqu'au bout (délai dépassé, lancement impossible). */
export function echecLancement(message: string, delaiS: number, depasse: boolean): Pick<AutotaskV2Resultat, 'ok' | 'ligne' | 'fait' | 'code'> {
  const fait = depasse || /tim(e|ed) ?out|délai/i.test(message) ? `délai dépassé (${delaiS} s)` : `lancement impossible : ${court(message, 200)}`

  return { ok: false, ligne: `KO ${fait}`, fait, code: null }
}
