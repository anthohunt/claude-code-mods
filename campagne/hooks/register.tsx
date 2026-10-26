import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Campagne, EnCours, Etat, Question, Releve, Resultat, Tache } from '../types'
import { cleMinute, estMinutePrevue, hhmm, isoParis, prochainPassage } from './temps'

// Mode manager de campagne : la session qui active une campagne en devient le manager.
// Toutes les `cadence_min` minutes, un passage obligatoire : les agents travaillent (sinon intervenir), leurs questions
// ont une réponse (trancher seul, ou mettre de côté pour l’utilisateur sans arrêter la campagne), chaque verdict est lu.
// Le code vérifie chaque obligation par son script OK/KO à la fin du tour et relance tant qu'il reste un KO (borné).

type D = EngineInterface

const PANE = 'campagne'
const ETAT = atom({ plugin: 'campagne', key: 'etat' } as const, null as Etat | null)
const TIC_MS = 20_000
const RELEVE_MS = 60_000
const REPRISES_MAX = 4
const SANS_TOUR_MS = 30 * 60_000

// ——— palette (hex : le terminal et le Desktop la dessinent tous deux) ———
const C = {
  accent: '#7aa2f7',
  ok: '#4fbf73',
  travail: '#e0af68',
  juge: '#7dcfff',
  attente: '#737aa2',
  ko: '#f7768e',
  trait: '#3b4261',
}
const PHASES: Record<string, { mot: string; glyphe: string; couleur: string }> = {
  validee: { mot: 'validée', glyphe: '●', couleur: C.ok },
  travail: { mot: 'au travail', glyphe: '◐', couleur: C.travail },
  juge: { mot: 'chez le juge', glyphe: '◑', couleur: C.juge },
  attente: { mot: 'en attente', glyphe: '○', couleur: C.attente },
  arret: { mot: 'à l’arrêt', glyphe: '■', couleur: C.ko },
}
const phase = (p: string) => PHASES[p] ?? PHASES.attente

// ——— utilitaires ———

const minutesDe = (cadence: number) => {
  const n = Math.max(5, Math.min(60, Math.round(cadence)))
  const l: number[] = []
  for (let m = 0; m < 60; m += n) l.push(m)

  return l
}

const valider = (source: string): { ok: true; c: Campagne } | { ok: false; erreurs: string[] } => {
  let x: Record<string, unknown>
  try {
    x = JSON.parse(source)
  } catch (err) {
    return { ok: false, erreurs: [`JSON illisible : ${err instanceof Error ? err.message : String(err)}`] }
  }
  const e: string[] = []
  for (const k of ['titre', 'but', 'ou', 'releve', 'interdits']) if (typeof x[k] !== 'string' || !(x[k] as string).trim()) e.push(`« ${k} » manquant ou vide`)
  if (typeof x.cadence_min !== 'number' || x.cadence_min < 5 || x.cadence_min > 60) e.push('« cadence_min » : un nombre de minutes entre 5 et 60')
  const a = x.arret as Record<string, unknown> | undefined
  if (!a || typeof a.texte !== 'string' || typeof a.controle !== 'string') e.push('« arret » : { texte, controle }')
  const o = x.obligations
  if (!Array.isArray(o) || o.length === 0) e.push('« obligations » : au moins une')
  else
    o.forEach((y: Record<string, unknown>, i) => {
      for (const k of ['id', 'titre', 'attendu', 'controle', 'si_ko']) if (typeof y?.[k] !== 'string' || !(y[k] as string).trim()) e.push(`obligation ${i + 1} : « ${k} » manquant`)
    })

  return e.length ? { ok: false, erreurs: e } : { ok: true, c: x as unknown as Campagne }
}

const derniere = (t: string) => t.split('\n').map(l => l.trim()).filter(Boolean).at(-1) ?? ''

const controler = async ($: D, dossier: string, controle: string): Promise<Resultat> => {
  try {
    const s = await $.process.run(['bash', '-c', controle], { cwd: dossier, timeoutMs: 120_000 })
    const l = derniere(s.stdout).slice(0, 300)
    if (/^OK\b/.test(l) && s.exitCode === 0) return { ok: true, ligne: l }

    return { ok: false, ligne: /^KO\b/.test(l) ? l : `KO le script n'a pas dit OK/KO (code ${s.exitCode}) ${derniere(s.stderr).slice(0, 160)}` }
  } catch (err) {
    return { ok: false, ligne: `KO lancement impossible : ${err instanceof Error ? err.message : String(err)}` }
  }
}

const changer = async ($: D, fn: (e: Etat) => Etat) => {
  const e = await update($, ETAT, v => (v ? (JSON.parse(JSON.stringify(fn(v))) as Etat) : v))
  if (e) await $.fs.write(`${e.dossier}/etat.json`, `${JSON.stringify({ ...e, releve: undefined }, null, 2)}\n`).catch(() => undefined)

  return e
}

const tracer = async ($: D, dossier: string, ligne: Record<string, unknown>) => {
  await $.process.run(['bash', '-c', 'cat >> passages.jsonl'], { cwd: dossier, stdin: `${JSON.stringify(ligne)}\n`, timeoutMs: 10_000 }).catch(() => undefined)
}

const lireQuestions = async ($: D, dossier: string): Promise<Question[]> => {
  try {
    const q = JSON.parse(await $.fs.read(`${dossier}/questions.json`))

    return Array.isArray(q) ? (q as Question[]).filter(x => (x.statut ?? 'ouverte') === 'ouverte') : []
  } catch {
    return []
  }
}

const releverMaintenant = async ($: D) => {
  const e = await read($, ETAT)
  if (!e || e.statut !== 'active') return
  let releve: Releve
  try {
    const cmd = e.c.releve.includes('/') ? e.c.releve : `./${e.c.releve}`
    const s = await $.process.run(['bash', '-c', cmd], { cwd: e.dossier, timeoutMs: 60_000 })
    const l = derniere(s.stdout)
    releve = l.startsWith('{') ? (JSON.parse(l) as Releve) : { erreur: `relevé sans JSON (code ${s.exitCode}) ${derniere(s.stderr).slice(0, 160)}` }
  } catch (err) {
    releve = { erreur: `relevé impossible : ${err instanceof Error ? err.message : String(err)}` }
  }
  const questions = await lireQuestions($, e.dossier)
  await update($, ETAT, v => (v ? { ...v, releve: { ...releve, at: releve.at ?? new Date().toISOString() }, questions } : v))
}

const compte = (r: Releve | null) => {
  const t = r?.taches ?? []

  return { valides: t.filter(x => x.statut === 'PASS').length, total: t.length, travail: t.filter(x => x.phase === 'travail').length }
}

// ——— messages ———

const resumeReleve = (e: Etat) => {
  const r = e.releve
  if (!r || r.erreur) return `Relevé : ${r?.erreur ?? 'pas encore fait'}`
  const k = compte(r)
  const t = (r.taches ?? []).map(x => `${x.id} ${phase(x.phase).mot}${x.activite_min != null && x.phase !== 'validee' ? ` (activité il y a ${x.activite_min} min)` : ''}`).join(' · ')

  return [
    `Relevé de ${r.at ? hhmm(Date.parse(r.at)) : '—'} : ${k.valides}/${k.total} validées · ${r.agents ?? 0} agents vivants · ${(r.demandes ?? []).length} demande(s) sans réponse · ${r.verdicts ?? 0} verdicts · ${r.disque_go ?? '?'} Go libres`,
    `Tâches : ${t}`,
  ].join('\n')
}

const messageReveil = (e: Etat, ref: string, heure: string, r: Record<string, Resultat>) =>
  [
    `[campagne] ${e.c.titre} — passage manager de ${heure} (réf. ${ref})`,
    '',
    `Tu es le manager de cette campagne : tu gères les agents et tu fais avancer la campagne. But : ${e.c.but}`,
    `Où : ${e.c.ou}. Dossier de la campagne : ${e.dossier}`,
    '',
    'Passage obligatoire. Chaque obligation est contrôlée par son script à la fin de ton tour ; tant qu’une reste KO, le passage reprend.',
    ...e.c.obligations.flatMap(o => [
      `${r[o.id] ? (r[o.id].ok ? '✓' : '✗') : '·'} ${o.id} ${o.titre} — attendu : ${o.attendu}`,
      `   état : ${r[o.id]?.ligne ?? 'pas encore contrôlé'}`,
      `   contrôle : ${o.controle}`,
      `   si KO : ${o.si_ko}`,
    ]),
    '',
    resumeReleve(e),
    '',
    `Questions mises de côté pour l’utilisateur : ${e.questions.length}${e.questions.length ? ` (${e.questions.map(q => q.id).join(', ')})` : ''}. Une question importante ne bloque pas la campagne : les agents continuent le reste.`,
    `Interdits : ${e.c.interdits}`,
    '',
    'Fais le travail d’abord (vérifier, intervenir, répondre), puis termine par trois lignes :',
    'Agents : <ce que tu as constaté et fait>',
    'Questions : <les décisions prises, ou « aucune »>',
    'Pour l’utilisateur : « rien », ou la seule question qui l’attend',
  ].join('\n')

const messageReprise = (e: Etat, ref: string, n: number, r: Record<string, Resultat>) => {
  const ko = e.c.obligations.filter(o => !r[o.id]?.ok)

  return [
    `[campagne] ${e.c.titre} — reprise ${n}/${REPRISES_MAX} du passage (réf. ${ref})`,
    '',
    `Encore ${ko.length} obligation(s) KO après ton tour :`,
    ...ko.flatMap(o => [`✗ ${o.id} ${o.titre}`, `   état : ${r[o.id]?.ligne ?? '—'}`, `   si KO : ${o.si_ko}`]),
    '',
    'Règle-les, puis termine par les trois lignes Agents / Questions / Pour l’utilisateur.',
  ].join('\n')
}

// ——— passages ———

const refDe = (slug: string, cle: string, n: number) => `${slug}/${cle.replace(/[-: ]/g, '').replace(/^(\d{8})/, '$1-')}/r${n}`

const controlerTout = async ($: D, e: Etat) => {
  const l = [{ id: 'arret', controle: e.c.arret.controle }, ...e.c.obligations]
  const s = await Promise.all(l.map(async x => [x.id, await controler($, e.dossier, x.controle)] as const))

  return Object.fromEntries(s) as Record<string, Resultat>
}

const terminer = async ($: D, e: Etat, r: Record<string, Resultat>) => {
  const t = await $.clock.now()
  await changer($, x => ({ ...x, statut: 'accomplie', fin: new Date(t).toISOString(), enCours: null, prochain: null, resultats: { ...x.resultats, ...r } }))
  await tracer($, e.dossier, { heure: isoParis(t), type: 'accomplie', ligne: r.arret?.ligne })
  $.ui.toast(`campagne : « ${e.c.titre} » accomplie — ${e.c.arret.texte}`)
  void $.prompt.submit({ text: `[campagne] ${e.c.titre} — accomplie (${r.arret?.ligne}). Rends le compte rendu final à l’utilisateur : ce qui a été validé, ce qui reste ouvert, les questions mises de côté.`, asUser: true }).catch(() => undefined)
}

const lancerPassage = async ($: D, cle: string, declencheur: 'horaire' | 'commande'): Promise<string> => {
  const t = await $.clock.now()
  let pris = false
  await changer($, e => {
    pris = e.statut === 'active' && !e.enCours
    if (!pris) return { ...e, dernierCle: cle }
    const iso = new Date(t).toISOString()

    return { ...e, dernierCle: cle, enCours: { ref: refDe(e.slug, cle, 0), debut: iso, depuis: iso, reprises: 0, phase: 'tour' } }
  })
  const e = await read($, ETAT)
  if (!e) return 'aucune campagne.'
  if (!pris) return e.enCours ? `un passage est déjà en cours (réf. ${e.enCours.ref}).` : `campagne ${e.statut}.`
  await releverMaintenant($)
  const r = await controlerTout($, e)
  if (r.arret?.ok) {
    await terminer($, e, r)

    return 'campagne accomplie.'
  }
  const e2 = (await read($, ETAT)) ?? e
  const ref = e2.enCours?.ref ?? refDe(e.slug, cle, 0)
  await changer($, x => ({ ...x, resultats: { ...x.resultats, ...r }, prochain: new Date(prochainPassage(minutesDe(x.c.cadence_min), t)).toISOString(), passages: x.passages + 1 }))
  await tracer($, e.dossier, { heure: isoParis(t), type: 'reveil', ref, declencheur, scripts: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.ligne])) })
  void $.prompt.submit({ text: messageReveil({ ...e2, resultats: { ...e2.resultats, ...r } }, ref, hhmm(t), r), asUser: true }).catch(() => undefined)

  return `passage de ${hhmm(t)} lancé (réf. ${ref}).`
}

const finDeTour = async ($: D, e: Etat, c: EnCours, interrompu: boolean): Promise<string> => {
  await changer($, x => ({ ...x, enCours: x.enCours && { ...x.enCours, phase: 'verification' } }))
  const r = await controlerTout($, e)
  const t = await $.clock.now()
  void releverMaintenant($)
  if (r.arret?.ok) {
    await terminer($, e, r)

    return `campagne : accomplie — ${r.arret.ligne}`
  }
  const ko = e.c.obligations.filter(o => !r[o.id]?.ok).map(o => o.id)
  const fermer = (issue: NonNullable<Etat['dernierPassage']>['issue']) =>
    changer($, x => ({ ...x, resultats: { ...x.resultats, ...r }, enCours: null, prochain: new Date(prochainPassage(minutesDe(x.c.cadence_min), t)).toISOString(), dernierPassage: { heure: new Date(t).toISOString(), issue, ko } }))
  const base = { heure: isoParis(t), ref: c.ref, reprise: c.reprises, scripts: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.ligne])) }
  if (interrompu) {
    await fermer('interrompu')
    await tracer($, e.dossier, { ...base, type: 'interrompu' })

    return 'campagne : tour interrompu, prochain passage à l’heure prévue.'
  }
  if (ko.length === 0) {
    await fermer('ok')
    await tracer($, e.dossier, { ...base, type: 'passage', issue: 'ok' })

    return `campagne : ✓ passage conforme, ${e.c.obligations.length} obligation(s) OK`
  }
  if (c.reprises >= REPRISES_MAX) {
    await fermer('borne')
    await tracer($, e.dossier, { ...base, type: 'passage', issue: 'borne', ko })

    return `campagne : ${ko.join(', ')} encore KO après ${REPRISES_MAX} reprises ; prochain passage à l’heure prévue.`
  }
  const n = c.reprises + 1
  const ref = c.ref.replace(/\/r\d+$/, `/r${n}`)
  await changer($, x => ({ ...x, resultats: { ...x.resultats, ...r }, enCours: x.enCours && { ...x.enCours, ref, reprises: n, phase: 'tour', turnId: undefined, depuis: new Date(t).toISOString() }, dernierPassage: { heure: new Date(t).toISOString(), issue: 'reprise', ko } }))
  await tracer($, e.dossier, { ...base, type: 'reprise', ko, suivante: ref })
  const e2 = (await read($, ETAT)) ?? e
  void $.prompt.submit({ text: messageReprise(e2, ref, n, r), asUser: true }).catch(() => undefined)

  return `campagne : reprise ${n}/${REPRISES_MAX} — ${ko.join(', ')} KO`
}

const tic = async ($: D) => {
  const e = await read($, ETAT)
  if (!e || e.statut !== 'active') return
  const t = await $.clock.now()
  const c = e.enCours
  if (c && c.phase === 'tour' && !c.turnId && t - Date.parse(c.depuis) > SANS_TOUR_MS) {
    await changer($, x => ({ ...x, enCours: null, dernierPassage: { heure: new Date(t).toISOString(), issue: 'abandon', ko: [] } }))
    await tracer($, e.dossier, { heure: isoParis(t), ref: c.ref, type: 'abandon' })
  }
  const minutes = minutesDe(e.c.cadence_min)
  const cle = cleMinute(t)
  if (estMinutePrevue(minutes, t) && cle !== e.dernierCle) await lancerPassage($, cle, 'horaire')
}

// ——— activation ———

const ouvrir = ($: D) => void $.ui.open({ id: PANE, title: 'Campagne', columns: 78 }).catch(() => undefined)

const demarrer = async ($: D, racine: string, slug: string): Promise<string> => {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(slug)) return 'usage : /campagne start <slug> (le dossier <racine>/<slug>/ qui contient campagne.json)'
  const dossier = `${racine}/${slug}`
  let source: string
  try {
    source = await $.fs.read(`${dossier}/campagne.json`)
  } catch {
    return `${dossier}/campagne.json introuvable. /campagne nouvelle construit une campagne.`
  }
  const v = valider(source)
  if (!v.ok) return [`${dossier}/campagne.json refusé :`, ...v.erreurs.map(x => `• ${x}`)].join('\n')
  const t = await $.clock.now()
  const minutes = minutesDe(v.c.cadence_min)
  const etat: Etat = {
    slug,
    dossier,
    c: v.c,
    statut: 'active',
    depuis: new Date(t).toISOString(),
    prochain: new Date(prochainPassage(minutes, t)).toISOString(),
    dernierCle: estMinutePrevue(minutes, t) ? cleMinute(t) : null,
    releve: null,
    questions: [],
    resultats: {},
    enCours: null,
    dernierPassage: null,
    passages: 0,
  }
  await update($, ETAT, () => etat)
  await $.fs.write(`${racine}/actif.json`, `${JSON.stringify({ slug, depuis: etat.depuis }, null, 2)}\n`).catch(() => undefined)
  await tracer($, dossier, { heure: isoParis(t), type: 'start', cadence_min: v.c.cadence_min })
  ouvrir($)
  void releverMaintenant($)
  void controlerTout($, etat).then(r => changer($, x => ({ ...x, resultats: { ...x.resultats, ...r } })))

  return `« ${v.c.titre} » active, cette session en est le manager. Passage toutes les ${v.c.cadence_min} min (prochain ${hhmm(Date.parse(etat.prochain ?? ''))}) ; /campagne passage pour un passage tout de suite.`
}

const NOUVELLE = (racine: string) =>
  [
    '[campagne] Construire une nouvelle campagne.',
    '',
    `Aide l’utilisateur à définir la campagne, une question à la fois, puis écris ${racine}/<slug>/campagne.json et ses scripts :`,
    '• le but et le critère de fin (un script controles/arret.sh qui dit OK quand c’est fini) ;',
    '• où tournent les agents et le moteur ;',
    '• la cadence des passages manager (en minutes) et les obligations de chaque passage, chacune avec son script OK/KO et ce qu’il faut faire si KO ;',
    '• releve.sh : un JSON sur une ligne (taches, agents, demandes, services, disque_go, verdicts, journal) que le panneau affiche ;',
    '• les interdits.',
    'Fais valider le critère de fin par l’utilisateur (OUI explicite), puis lance /campagne start <slug>.',
  ].join('\n')

// ——— rendu ———

const duree = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000))

  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

const svgProgres = (taches: Tache[]) => {
  const n = Math.max(1, taches.length)
  const w = 560
  const g = 6
  const cw = (w - g * (n - 1)) / n
  const rects = taches
    .map((x, i) => {
      const p = phase(x.phase)
      const xx = (i * (cw + g)).toFixed(1)

      return `<rect x="${xx}" y="0" width="${cw.toFixed(1)}" height="14" rx="5" fill="${p.couleur}" opacity="${x.phase === 'attente' ? 0.35 : 1}"/><text x="${(i * (cw + g) + cw / 2).toFixed(1)}" y="32" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" fill="#8b93b5">${x.id}</text>`
    })
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 38" width="${w}" height="38">${rects}</svg>`
}

export const register: Register = (on, options) => {
  let racine = String(options.racine ?? '~/campagnes').replace(/\/+$/, '')

  on('session.start', async ($, e, next) => {
    // « ~ » au début de la racine = dossier personnel (USERPROFILE sous Windows, HOME ailleurs).
    if (racine.startsWith('~')) racine = `${((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')}${racine.slice(1)}`
    $.clock.every(TIC_MS, () => tic($).catch(err => void $.ui.log(`campagne : tic en échec (${err instanceof Error ? err.message : String(err)})`)))
    $.clock.every(RELEVE_MS, () => releverMaintenant($).catch(() => undefined))
    await $.command.register({ name: 'campagne', description: 'Mode manager de campagne : panneau, start <slug>, passage, stop, nouvelle', argumentHint: '[start <slug> | passage | stop | nouvelle]' })

    return next(e)
  })

  on('command.run', { command: 'campagne' }, async ($, e) => {
    const [verbe = '', ...reste] = e.args.trim().split(/\s+/)
    if (verbe === 'start') return { text: await demarrer($, racine, reste.join(' ')) }
    if (verbe === 'nouvelle') {
      void $.prompt.submit({ text: NOUVELLE(racine), asUser: true }).catch(() => undefined)

      return { text: 'construction d’une nouvelle campagne.' }
    }
    const etat = await read($, ETAT)
    if (verbe === 'passage') {
      if (!etat || etat.statut !== 'active') return { text: 'aucune campagne active.' }

      return { text: `${await lancerPassage($, cleMinute(await $.clock.now()), 'commande')}` }
    }
    if (verbe === 'stop') {
      if (!etat || etat.statut !== 'active') return { text: 'aucune campagne active.' }
      const t = await $.clock.now()
      await changer($, x => ({ ...x, statut: 'arretee', fin: new Date(t).toISOString(), enCours: null, prochain: null }))
      await tracer($, etat.dossier, { heure: isoParis(t), type: 'stop' })
      await $.fs.write(`${racine}/actif.json`, '{}\n').catch(() => undefined)

      return { text: `« ${etat.c.titre} » arrêtée. Plus de passage manager (les agents, eux, continuent).` }
    }
    if (verbe !== '') return { text: 'usage : /campagne [start <slug> | passage | stop | nouvelle]' }
    if (etat && etat.statut === 'active') {
      ouvrir($)
      void releverMaintenant($)

      return { text: `« ${etat.c.titre} » active, prochain passage ${etat.prochain ? hhmm(Date.parse(etat.prochain)) : '—'}.` }
    }
    let actif = ''
    try {
      actif = String(JSON.parse(await $.fs.read(`${racine}/actif.json`)).slug ?? '')
    } catch {
      /* aucune */
    }
    if (actif && (await $.fs.exists(`${racine}/${actif}/campagne.json`))) return { text: await demarrer($, racine, actif) }
    void $.prompt.submit({ text: NOUVELLE(racine), asUser: true }).catch(() => undefined)

    return { text: 'aucune campagne active : on en construit une.' }
  })

  on('turn.start', async ($, e, next) => {
    const etat = await read($, ETAT)
    const c = etat?.enCours
    if (c && c.phase === 'tour' && !c.turnId && e.text.includes(`réf. ${c.ref}`)) await changer($, x => ({ ...x, enCours: x.enCours && x.enCours.ref === c.ref ? { ...x.enCours, turnId: e.turnId } : x.enCours }))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    const etat = await read($, ETAT)
    const c = etat?.enCours
    if (!etat || etat.statut !== 'active' || !c || c.phase !== 'tour' || c.turnId !== e.turnId) return r
    try {
      const ligne = await finDeTour($, etat, c, e.reason !== 'answer')
      $.ui.log(ligne)

      return { ...r, text: r.text ? `${r.text}\n${ligne}` : ligne }
    } catch (err) {
      await changer($, x => ({ ...x, enCours: null }))
      $.ui.log(`campagne : vérification impossible (${err instanceof Error ? err.message : String(err)})`)

      return r
    }
  })

  // ——— bande au-dessus de la saisie : la campagne est toujours visible ———
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const etat = await read($, ETAT)
    if (!etat || etat.statut !== 'active') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const k = compte(etat.releve)
    const q = etat.questions.length
    const quoi = etat.enCours ? `passage ${etat.enCours.phase === 'verification' ? 'en vérification' : 'en cours'}${etat.enCours.reprises ? ` · reprise ${etat.enCours.reprises}` : ''}` : `prochain passage ${etat.prochain ? hhmm(Date.parse(etat.prochain)) : '—'}`

    return (
      <Box>
        <Text wrap="truncate-end">
          <Text color={C.accent} weight="bold">◆ Manager </Text>
          <Text>{etat.c.titre}</Text>
          <Text dimColor>{'  ·  '}</Text>
          <Text color={C.ok}>{`${k.valides}/${k.total || '?'} validées`}</Text>
          <Text dimColor>{'  ·  '}</Text>
          <Text color={C.travail}>{`${etat.releve?.agents ?? '?'} agents`}</Text>
          <Text dimColor>{'  ·  '}</Text>
          <Text color={q ? C.travail : undefined} dimColor={!q}>{`${q} question${q > 1 ? 's' : ''} pour toi`}</Text>
          <Text dimColor>{`  ·  ${quoi}`}</Text>
        </Text>
      </Box>
    )
  })

  // ——— panneau ———
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const el = $.ui.resolve(e)
    const { Box, Text, Button } = el
    // Le terminal n'a pas d'Svg : il dessine la barre en caractères ; Desktop et mobile ont le dessin.
    const Svg = e.surface !== 'terminal' && 'Svg' in el ? (el as { Svg: typeof Box }).Svg : undefined
    const etat = await read($, ETAT)
    if (!etat)
      return (
        <Box flexDirection="column" padding={1} gap={1}>
          <Text color={C.accent} weight="bold">◆ Campagne</Text>
          <Text dimColor>Aucune campagne active. /campagne en active une, ou en construit une s’il n’y en a pas.</Text>
        </Box>
      )
    const now = await $.clock.now()
    const r = etat.releve
    const taches = r?.taches ?? []
    const k = compte(r)
    const actif = etat.statut === 'active'
    const age = r?.at ? duree(now - Date.parse(r.at)) : null
    const prochain = etat.prochain ? Date.parse(etat.prochain) : null
    const tuile = (cle: string, valeur: string, sous: string, couleur?: string) => (
      <Box key={`tuile-${cle}`} flexDirection="column" borderStyle="round" borderColor={C.trait} paddingX={1} flexGrow={1} flexShrink={1} width="25%">
        <Text dimColor size="caption">{cle}</Text>
        <Text weight="bold" size="title" color={couleur} tabular>{valeur}</Text>
        <Text dimColor size="caption" wrap="truncate-end">{sous}</Text>
      </Box>
    )
    const parPhase = (p: string) => taches.filter(x => x.phase === p).length
    const legende = ['validee', 'travail', 'juge', 'attente', 'arret'].filter(p => parPhase(p) > 0)
    const barre = (
      <Box flexDirection="column">
        <Text>
          {taches.map(x => (
            <Text key={`b-${x.id}`} color={phase(x.phase).couleur} dimColor={x.phase === 'attente'}>{'━━━━━━━ '}</Text>
          ))}
        </Text>
        <Text>
          {legende.map((p, i) => (
            <Text key={`l-${p}`}>
              {i ? <Text dimColor>{'   '}</Text> : null}
              <Text color={phase(p).couleur}>{`${phase(p).glyphe} ${parPhase(p)} ${phase(p).mot}`}</Text>
            </Text>
          ))}
        </Text>
      </Box>
    )
    const passage = etat.enCours
      ? { texte: `passage ${etat.enCours.phase === 'verification' ? 'en vérification' : 'en cours'}${etat.enCours.reprises ? ` (reprise ${etat.enCours.reprises}/${REPRISES_MAX})` : ''}`, couleur: C.travail }
      : etat.dernierPassage
        ? { texte: `dernier passage ${hhmm(Date.parse(etat.dernierPassage.heure))} : ${etat.dernierPassage.issue === 'ok' ? 'conforme' : etat.dernierPassage.issue === 'borne' ? `${etat.dernierPassage.ko.join(', ')} encore KO` : etat.dernierPassage.issue}`, couleur: etat.dernierPassage.issue === 'ok' ? C.ok : C.ko }
        : { texte: 'aucun passage encore', couleur: C.attente }

    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text color={C.accent} weight="bold" size="title">{`◆ ${etat.c.titre}`}</Text>
            <Text color={actif || etat.statut === 'accomplie' ? C.ok : C.ko} weight="bold">
              {actif ? '● manager actif' : etat.statut === 'accomplie' ? '● accomplie' : '○ arrêtée'}
            </Text>
          </Box>
          <Text dimColor wrap="wrap">{etat.c.but}</Text>
        </Box>

        <Box flexDirection="column">
          {Svg && taches.length ? <Svg source={svgProgres(taches)} alt={`${k.valides} tâches validées sur ${k.total}`} /> : barre}
        </Box>

        <Box flexDirection="row" gap={1}>
          {tuile('Validées', `${k.valides}/${k.total || '—'}`, 'par le juge', C.ok)}
          {tuile('Agents', `${r?.agents ?? '—'}`, `${k.travail} au travail`, C.travail)}
          {tuile('Pour toi', `${etat.questions.length}`, etat.questions.length ? 'en attente' : 'aucune', etat.questions.length ? C.travail : undefined)}
          {tuile('Verdicts', `${r?.verdicts ?? '—'}`, r?.dernier_verdict ? `dernier : ${r.dernier_verdict.tache} ${r.dernier_verdict.verdict}` : '—')}
        </Box>

        {r?.erreur ? (
          <Box borderStyle="round" borderColor={C.ko} paddingX={1}>
            <Text color={C.ko}>{`Relevé en échec : ${r.erreur}`}</Text>
          </Box>
        ) : null}

        <Box flexDirection="column">
          <Text weight="bold">Tâches</Text>
          {taches.map(x => {
            const p = phase(x.phase)
            const detail = x.phase === 'validee' ? `${x.jugees} soumission(s)` : x.phase === 'attente' ? (x.attend ? `après ${x.attend}` : '') : x.phase === 'juge' ? 'prête, en file pour le juge' : `${x.activite_min != null ? `il y a ${x.activite_min} min` : ''}${x.refus ? ` · ${x.refus} refus` : ''}`

            return (
              <Box key={`t-${x.id}`} flexDirection="row" gap={1}>
                <Text color={p.couleur}>{p.glyphe}</Text>
                <Box width={3} flexShrink={0}><Text weight="bold">{x.id}</Text></Box>
                <Box flexGrow={1} flexShrink={1} minWidth={10}><Text wrap="truncate-end">{x.titre}</Text></Box>
                <Box width={9} flexShrink={0}><Text dimColor>{x.poste}</Text></Box>
                <Box width={12} flexShrink={0}><Text color={p.couleur}>{p.mot}</Text></Box>
                <Box width={27} flexShrink={0}><Text dimColor wrap="truncate-end">{detail}</Text></Box>
              </Box>
            )
          })}
          {taches.length === 0 ? <Text dimColor>{r ? 'aucune tâche relevée' : 'premier relevé en cours…'}</Text> : null}
        </Box>

        {etat.questions.length ? (
          <Box flexDirection="column" borderStyle="round" borderColor={C.travail} paddingX={1}>
            <Text color={C.travail} weight="bold">Questions pour toi</Text>
            {etat.questions.map(q => (
              <Box key={`q-${q.id}`} flexDirection="column">
                <Text>{`${q.id} · ${q.de} — ${q.question}`}</Text>
                <Text dimColor>{`depuis ${q.depuis}${q.demande ? ` · ${q.demande}` : ''} · la campagne continue`}</Text>
              </Box>
            ))}
          </Box>
        ) : null}

        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text weight="bold">{`Passage manager · toutes les ${etat.c.cadence_min} min`}</Text>
            <Text color={passage.couleur}>{passage.texte}</Text>
          </Box>
          {actif && prochain && !etat.enCours ? <Text color={C.accent}>{`prochain passage ${hhmm(prochain)} · dans ${duree(prochain - now)}`}</Text> : null}
          {etat.c.obligations.map(o => {
            const x = etat.resultats[o.id]

            return (
              <Box key={`o-${o.id}`} flexDirection="row" gap={1}>
                <Text color={x ? (x.ok ? C.ok : C.ko) : C.attente}>{x ? (x.ok ? '✓' : '✗') : '·'}</Text>
                <Box width={3} flexShrink={0}><Text weight="bold">{o.id}</Text></Box>
                <Box flexDirection="column" flexShrink={1}>
                  <Text>{o.titre}</Text>
                  <Text dimColor wrap="truncate-end">{x?.ligne ?? 'pas encore contrôlé'}</Text>
                </Box>
              </Box>
            )
          })}
        </Box>

        {r?.journal?.length ? (
          <Box flexDirection="column">
            <Text weight="bold">Journal de la mission</Text>
            {r.journal.slice(-3).map((l, i) => (
              <Text key={`j-${i}`} dimColor wrap="truncate-end">{l}</Text>
            ))}
          </Box>
        ) : null}

        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            {actif ? (
              <Button key="passage" variant="primary" hotkey="p" onPress={() => void lancerPassage($, cleMinute(Date.now()), 'commande').then(t => $.ui.toast(`campagne : ${t}`))}>
                Passage maintenant
              </Button>
            ) : null}
            <Button key="releve" hotkey="r" onPress={() => void releverMaintenant($)}>
              Rafraîchir
            </Button>
          </Box>
          <Text dimColor wrap="truncate-end">{age ? `relevé il y a ${age} · ${r?.disque_go ?? '?'} Go libres · pont ${r?.pont ?? '?'}` : 'relevé en cours…'}</Text>
        </Box>
      </Box>
    )
  })
}
