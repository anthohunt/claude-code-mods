/** Heure de Paris sans Intl : CET (UTC+1), CEST (UTC+2) du dernier dimanche de mars 01:00 UTC au dernier dimanche d'octobre 01:00 UTC. */

const H = 3_600_000
const MIN = 60_000

const dernierDimanche = (annee: number, mois: number) => {
  const fin = new Date(Date.UTC(annee, mois + 1, 0))

  return Date.UTC(annee, mois, fin.getUTCDate() - fin.getUTCDay(), 1)
}

/** Décalage de Paris sur UTC à cet instant, en millisecondes. */
export function decalageParis(ms: number): number {
  const annee = new Date(ms).getUTCFullYear()

  return ms >= dernierDimanche(annee, 2) && ms < dernierDimanche(annee, 9) ? 2 * H : H
}

export type Paris = { annee: number; mois: number; jour: number; heure: number; minute: number; seconde: number; decalage: number }

export function paris(ms: number): Paris {
  const decalage = decalageParis(ms)
  const d = new Date(ms + decalage)

  return { annee: d.getUTCFullYear(), mois: d.getUTCMonth() + 1, jour: d.getUTCDate(), heure: d.getUTCHours(), minute: d.getUTCMinutes(), seconde: d.getUTCSeconds(), decalage }
}

const d2 = (n: number) => String(n).padStart(2, '0')

/** « 17 h 52 ». */
export const hhmm = (ms: number) => {
  const p = paris(ms)

  return `${d2(p.heure)} h ${d2(p.minute)}`
}

/** « 07/10 17 h 52 ». */
export const jourHeure = (ms: number) => {
  const p = paris(ms)

  return `${d2(p.jour)}/${d2(p.mois)} ${hhmm(ms)}`
}

/** Clé de la minute à Paris : « 2026-10-07 17:52 ». */
export const cleMinute = (ms: number) => {
  const p = paris(ms)

  return `${p.annee}-${d2(p.mois)}-${d2(p.jour)} ${d2(p.heure)}:${d2(p.minute)}`
}

/** Heure ISO de Paris avec son décalage : « 2026-10-07T17:52:00+02:00 ». */
export const isoParis = (ms: number) => {
  const p = paris(ms)

  return `${p.annee}-${d2(p.mois)}-${d2(p.jour)}T${d2(p.heure)}:${d2(p.minute)}:${d2(p.seconde)}+${d2(p.decalage / H)}:00`
}

/** Vrai quand la minute de Paris de cet instant est une minute de passage. */
export const estMinutePrevue = (frequence: readonly number[], ms: number) => frequence.includes(paris(ms).minute)

/** Début (ms) de la prochaine minute prévue strictement après `ms`. */
export function prochainPassage(frequence: readonly number[], ms: number): number {
  let t = Math.floor(ms / MIN) * MIN + MIN
  for (let i = 0; i < 26 * 60; i++, t += MIN) if (estMinutePrevue(frequence, t)) return t

  return t
}
