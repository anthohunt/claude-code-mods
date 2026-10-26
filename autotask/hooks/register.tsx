import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AutotaskV2Conformite, AutotaskV2EnCours, AutotaskV2Etat, AutotaskV2Mission, AutotaskV2Resultat } from '../types'
import { echecLancement, lireSortie } from './controle'
import { executable, toutesTaches, validerMission } from './mission'
import { cleMinute, estMinutePrevue, hhmm, isoParis, jourHeure, prochainPassage } from './temps'
import { messageArret, messageReprise, messageReveil, tachesKo, verifierReponse } from './textes'

type D = EngineInterface

const PANE = 'autotask-v2'
const ETAT = atom({ plugin: 'autotask-v2', key: 'etat' } as const, null as AutotaskV2Etat | null)
/** Tic de l'horloge : chaque minute prévue est vue au moins deux fois. */
const TIC_MS = 20_000
/** Un message de réveil dont le tour n'a jamais commencé est abandonné après ce délai. */
const SANS_TOUR_MS = 30 * 60_000

const couleur = (c: 'green' | 'red' | undefined) => (c ? { color: c } : {})

const borne = (v: unknown, min: number, max: number, defaut: number) => {
  const n = Number(v)

  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : defaut
}

type Config = { racine: string; delaiS: number; reprisesMax: number; shell: string }


// ——— traces ———

const ecrireEtat = async ($: D, e: AutotaskV2Etat | null) => {
  if (e) await $.fs.write(`${e.dossier}/etat.json`, `${JSON.stringify(e, null, 2)}\n`).catch(() => undefined)
}

const changer = async ($: D, fn: (e: AutotaskV2Etat) => AutotaskV2Etat) => {
  const e = await update($, ETAT, v => (v ? (JSON.parse(JSON.stringify(fn(v))) as AutotaskV2Etat) : v))
  await ecrireEtat($, e)

  return e
}

const tracer = async ($: D, k: Config, dossier: string, ligne: Record<string, unknown>) => {
  // Passe par le shell configuré : sur Windows, « tee » n'est pas forcément sur le PATH de l'hôte.
  await $.process.run([k.shell, '-c', 'cat >> passages.jsonl'], { cwd: dossier, stdin: `${JSON.stringify(ligne)}\n`, timeoutMs: 10_000 }).catch(() => undefined)
}

// ——— scripts ———

const lancer = async (k: Config, $: D, dossier: string, controle: string): Promise<AutotaskV2Resultat> => {
  const t0 = await $.clock.now()
  const heure = new Date(t0).toISOString()
  try {
    const s = await $.process.run([k.shell, '-c', controle], { cwd: dossier, timeoutMs: k.delaiS * 1000 })

    return { ...lireSortie(s), heure, ms: (await $.clock.now()) - t0 }
  } catch (err) {
    const ms = (await $.clock.now()) - t0

    return { ...echecLancement(err instanceof Error ? err.message : String(err), k.delaiS, ms >= k.delaiS * 1000 - 1000), heure, ms }
  }
}

const controler = async (k: Config, $: D, dossier: string, liste: ReadonlyArray<{ id: string; controle: string }>) => {
  const sorties = await Promise.all(liste.map(async x => [x.id, await lancer(k, $, dossier, x.controle)] as const))

  return Object.fromEntries(sorties) as Record<string, AutotaskV2Resultat>
}

const resume = (r: Record<string, AutotaskV2Resultat>) => Object.fromEntries(Object.entries(r).map(([id, x]) => [id, { ok: x.ok, ligne: x.ligne, code: x.code, ms: x.ms }]))

/** STOP, puis chaque critère d'arrêt : le premier OK arrête la mission. */
const arretAtteint = (m: AutotaskV2Mission, stop: boolean, r: Record<string, AutotaskV2Resultat>) => {
  if (stop) return { statut: 'arretee' as const, cause: 'fichier STOP' }
  const a = m.arret.find(x => r[x.id]?.ok)

  return a ? { statut: a.issue ?? ('arretee' as const), cause: `[${a.id}] ${a.texte}`, critere: a.id, ligne: r[a.id]?.ligne } : undefined
}

const arreter = async ($: D, e: AutotaskV2Etat, fin: NonNullable<ReturnType<typeof arretAtteint>>, r: Record<string, AutotaskV2Resultat>) => {
  const t = await $.clock.now()
  await changer($, x => ({ ...x, statut: fin.statut, fin: { heure: new Date(t).toISOString(), cause: fin.cause, critere: fin.critere, ligne: fin.ligne }, enCours: null, prochain: null, resultats: { ...x.resultats, ...r } }))
  await tracer($, k, e.dossier, { heure: isoParis(t), cle: e.enCours?.cle ?? cleMinute(t), type: 'arret', statut: fin.statut, cause: fin.cause, scripts: resume(r) })
  void $.prompt.submit({ text: messageArret({ mission: e.mission, statut: fin.statut, cause: fin.cause, ligne: fin.ligne, heure: hhmm(t), resultats: { ...e.resultats, ...r } }), asUser: true }).catch(() => undefined)
  $.ui.toast(`autotask : « ${e.mission.titre} » ${fin.statut === 'accomplie' ? 'accomplie' : 'arrêtée'} — ${fin.cause}`)
}

// ——— passage ———

const refDe = (slug: string, cle: string, n: number) => `${slug}/${cle.replace(/[-: ]/g, '').replace(/^(\d{8})/, '$1-')}/r${n}`

/** Prend le passage (un seul à la fois), contrôle les arrêts, puis envoie le réveil. Rend une phrase pour la commande. */
const lancerPassage = async (k: Config, $: D, cle: string, declencheur: AutotaskV2EnCours['declencheur']): Promise<string> => {
  const t = await $.clock.now()
  let pris = false
  let occupe: string | undefined
  const ref0 = (s: string) => refDe(s, cle, 0)
  await changer($, e => {
    pris = false
    occupe = e.enCours?.ref
    if (e.statut !== 'active' || e.enCours) return e.statut === 'active' ? { ...e, dernierCle: cle } : e
    pris = true
    const iso = new Date(t).toISOString()

    return { ...e, dernierCle: cle, enCours: { cle, ref: ref0(e.slug), phase: 'preparation', reprises: 0, debut: iso, depuis: iso, declencheur } }
  })
  const e = await read($, ETAT)
  if (!e) return 'aucune mission.'
  if (!pris) {
    if (e.statut !== 'active') return `mission ${e.statut}, pas de passage.`
    await changer($, x => ({ ...x, sautes: x.sautes + 1 }))
    await tracer($, k, e.dossier, { heure: isoParis(t), cle, type: 'saute', raison: `passage en cours (${occupe})` })

    return `un passage est déjà en cours (réf. ${occupe}) : rien d'empilé.`
  }

  try {
    const stop = await $.fs.exists(`${e.dossier}/STOP`)
    const r = stop ? {} : await controler(k, $, e.dossier, e.mission.arret)
    const fin = arretAtteint(e.mission, stop, r)
    if (fin) {
      await arreter($, e, fin, r)

      return `mission ${fin.statut === 'accomplie' ? 'accomplie' : 'arrêtée'} : ${fin.cause}.`
    }
    const ref = ref0(e.slug)
    const resultats = { ...e.resultats, ...r }
    const texte = messageReveil({ mission: e.mission, dossier: e.dossier, ref, heure: hhmm(t), resultats })
    const t2 = await $.clock.now()
    await changer($, x => ({ ...x, resultats: { ...x.resultats, ...r }, prochain: new Date(prochainPassage(x.mission.frequence, t2)).toISOString(), enCours: x.enCours && { ...x.enCours, phase: 'tour', depuis: new Date(t2).toISOString() } }))
    await tracer($, k, e.dossier, { heure: isoParis(t2), cle, ref, type: 'reveil', declencheur, scripts: resume(r) })
    void $.prompt.submit({ text: texte, asUser: true }).catch(() => undefined)

    return `passage de ${hhmm(t)} lancé (réf. ${ref}).`
  } catch (err) {
    await changer($, x => ({ ...x, enCours: null }))
    throw err
  }
}

/** Fin du tour d'un passage : tous les scripts, arrêt, conformité, puis reprise, borne ou fin du passage. */
const finDeTour = async (k: Config, $: D, e: AutotaskV2Etat, enCours: AutotaskV2EnCours, reponse: string, interrompu: boolean): Promise<string> => {
  const t0 = await $.clock.now()
  await changer($, x => ({ ...x, enCours: x.enCours && { ...x.enCours, phase: 'verification', depuis: new Date(t0).toISOString() } }))
  const stop = await $.fs.exists(`${e.dossier}/STOP`)
  const r = await controler(k, $, e.dossier, [...e.mission.arret, ...toutesTaches(e.mission)])
  const t = await $.clock.now()
  const resultats = { ...e.resultats, ...r }
  const type = enCours.reprises === 0 ? 'passage' : 'reprise'
  const base = { heure: isoParis(t), cle: enCours.cle, ref: enCours.ref, type, reprise: enCours.reprises, scripts: resume(r) }

  const fin = arretAtteint(e.mission, stop, r)
  if (fin) {
    await arreter($, e, fin, r)

    return `autotask : mission ${fin.statut === 'accomplie' ? 'accomplie' : 'arrêtée'} — ${fin.cause}`
  }

  const fermer = (issue: NonNullable<AutotaskV2Etat['dernierPassage']>['issue'], conformite: AutotaskV2Conformite | null) =>
    changer($, x => ({
      ...x,
      resultats: { ...x.resultats, ...r },
      enCours: null,
      prochain: new Date(prochainPassage(x.mission.frequence, t)).toISOString(),
      dernierPassage: { cle: enCours.cle, heure: new Date(t).toISOString(), issue, reprises: enCours.reprises, conformite },
    }))

  if (interrompu) {
    await fermer('interrompu', null)
    await tracer($, k, e.dossier, { ...base, conformite: null, decision: 'interrompu' })

    return 'autotask : tour interrompu, le passage s’arrête là (prochain à l’heure prévue).'
  }

  const conformite = verifierReponse(e.mission, reponse, resultats)
  const ko = tachesKo(e.mission, resultats)
  if (ko.length === 0 && conformite.conforme) {
    await fermer('ok', conformite)
    await tracer($, k, e.dossier, { ...base, conformite, decision: 'ok' })

    return `autotask : ✓ tout OK, réponse conforme (${toutesTaches(e.mission).length} tâche(s))`
  }

  if (enCours.reprises >= k.reprisesMax) {
    await fermer('borne', conformite)
    await tracer($, k, e.dossier, { ...base, conformite, decision: 'borne', note: `${k.reprisesMax} reprise(s) d'affilée : attente du passage suivant` })

    return `autotask : ${ko.length} KO, ${conformite.manques.length} manque(s) — ${k.reprisesMax} reprises épuisées, attente du passage suivant`
  }

  const n = enCours.reprises + 1
  const ref = refDe(e.slug, enCours.cle, n)
  await changer($, x => ({
    ...x,
    resultats: { ...x.resultats, ...r },
    enCours: x.enCours && { ...x.enCours, ref, phase: 'tour', reprises: n, turnId: undefined, depuis: new Date(t).toISOString() },
    dernierPassage: { cle: enCours.cle, heure: new Date(t).toISOString(), issue: 'reprise', reprises: n, conformite },
  }))
  await tracer($, k, e.dossier, { ...base, conformite, decision: 'reprise', suivante: ref })
  const debut = Date.parse(enCours.debut)
  void $.prompt
    .submit({ text: messageReprise({ mission: e.mission, dossier: e.dossier, ref, heurePassage: hhmm(debut), heure: hhmm(t), n, max: k.reprisesMax, resultats, conformite }), asUser: true })
    .catch(() => undefined)

  return `autotask : reprise ${n}/${k.reprisesMax} — ${ko.length} script(s) KO, ${conformite.manques.length} manque(s) dans la réponse`
}

// ——— horloge ———

const tic = async (k: Config, $: D) => {
  const e = await read($, ETAT)
  if (!e || e.statut !== 'active') return
  const t = await $.clock.now()
  const c = e.enCours
  if (c && c.phase === 'tour' && !c.turnId && t - Date.parse(c.depuis) > SANS_TOUR_MS) {
    await changer($, x => ({ ...x, enCours: null, dernierPassage: { cle: c.cle, heure: new Date(t).toISOString(), issue: 'abandon', reprises: c.reprises, conformite: null } }))
    await tracer($, k, e.dossier, { heure: isoParis(t), cle: c.cle, ref: c.ref, type: 'abandon', raison: 'aucun tour n’a commencé pour ce message' })
  }
  const prochain = new Date(prochainPassage(e.mission.frequence, t)).toISOString()
  if (prochain !== e.prochain && !estMinutePrevue(e.mission.frequence, t)) await changer($, x => ({ ...x, prochain }))
  const cle = cleMinute(t)
  if (estMinutePrevue(e.mission.frequence, t) && cle !== e.dernierCle) await lancerPassage(k, $, cle, 'horaire')
}

// ——— commandes ———

const ouvrirPane = ($: D) => void $.ui.open({ id: PANE, title: 'Autotask' }).catch(() => undefined)

const demarrer = async (k: Config, $: D, slug: string): Promise<string> => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(slug)) return 'usage : /autotask start <slug> (le dossier <racine>/<slug>/ qui contient mission.json)'
  const dossier = `${k.racine}/${slug}`
  const chemin = `${dossier}/mission.json`
  let source: string
  try {
    source = await $.fs.read(chemin)
  } catch {
    return `autotask : ${chemin} introuvable.`
  }
  const v = validerMission(source)
  if (!v.ok) return [`autotask : ${chemin} refusé (${v.erreurs.length} erreur(s)) :`, ...v.erreurs.map(x => `- ${x}`)].join('\n')
  const absents: string[] = []
  for (const x of [...v.mission.arret, ...toutesTaches(v.mission)]) {
    const f = executable(x.controle, dossier)
    if (f && !(await $.fs.exists(f))) absents.push(`- [${x.id}] script introuvable : ${f}`)
  }
  if (absents.length) return [`autotask : ${chemin} refusé :`, ...absents].join('\n')
  if (await $.fs.exists(`${dossier}/STOP`)) return `autotask : ${dossier}/STOP existe — retire-le pour démarrer la mission.`

  const t = await $.clock.now()
  const avant = await read($, ETAT)
  const etat: AutotaskV2Etat = {
    slug,
    dossier,
    mission: v.mission,
    statut: 'active',
    depuis: new Date(t).toISOString(),
    prochain: new Date(prochainPassage(v.mission.frequence, t)).toISOString(),
    dernierCle: estMinutePrevue(v.mission.frequence, t) ? cleMinute(t) : null,
    enCours: null,
    resultats: {},
    dernierPassage: null,
    sautes: 0,
  }
  await update($, ETAT, () => etat)
  await ecrireEtat($, etat)
  await tracer($, k, dossier, { heure: isoParis(t), type: 'start', frequence: v.mission.frequence })
  ouvrirPane($)
  const remplace = avant && avant.statut === 'active' && avant.slug !== slug ? ` (remplace « ${avant.mission.titre} »)` : ''

  return `autotask : « ${v.mission.titre} » active${remplace}, minutes ${v.mission.frequence.map(m => `:${String(m).padStart(2, '0')}`).join(' ')}, prochain passage ${hhmm(Date.parse(etat.prochain ?? ''))}.`
}

const texteEtat = (k: Config, e: AutotaskV2Etat | null): string => {
  if (!e) return 'autotask : aucune mission. /autotask start <slug> démarre <racine>/<slug>/mission.json.'
  const m = e.mission
  const marque = (id: string) => (e.resultats[id] ? (e.resultats[id]?.ok ? '✓' : '✗') : '·')
  const statut = e.statut === 'active' ? `active · prochain passage ${e.prochain ? jourHeure(Date.parse(e.prochain)) : '—'}` : `${e.statut} (${e.fin?.cause ?? ''})`

  return [
    `autotask : « ${m.titre} » — ${statut}`,
    `Mission : ${m.mission}`,
    ...(e.enCours ? [`En cours : ${e.enCours.ref} (${e.enCours.phase}, reprise ${e.enCours.reprises}/${k.reprisesMax})`] : []),
    ...(e.dernierPassage ? [`Dernier passage : ${e.dernierPassage.cle} → ${e.dernierPassage.issue}, ${e.dernierPassage.reprises} reprise(s)`] : []),
    'Arrêt :',
    ...m.arret.map(a => `  ${e.resultats[a.id]?.ok ? '■' : '□'} [${a.id}] ${a.texte} — ${e.resultats[a.id]?.ligne ?? 'pas encore contrôlé'}`),
    'Tâches :',
    ...toutesTaches(m).map(x => `  ${marque(x.id)} [${x.id}] ${x.titre} — ${e.resultats[x.id]?.ligne ?? 'pas encore contrôlé'}`),
  ].join('\n')
}

export const register: Register = (on, options) => {
  const k: Config = {
    racine: String(options.racine ?? '~/autotask').replace(/\/+$/, ''),
    delaiS: borne(options.delaiControle, 5, 600, 120),
    reprisesMax: borne(options.reprisesMax, 0, 20, 5),
    shell: String(options.shell ?? '').trim() || 'bash',
  }

  on('session.start', async ($, e, next) => {
    // « ~ » au début de la racine = dossier personnel (USERPROFILE sous Windows, HOME ailleurs).
    if (k.racine.startsWith('~')) k.racine = `${((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')}${k.racine.slice(1)}`
    $.clock.every(TIC_MS, () => tic(k, $).catch(err => void $.ui.log(`autotask : tic en échec (${err instanceof Error ? err.message : String(err)})`)))
    await $.command.register({ name: 'autotask', description: 'Mission autotask v2 : état, start <slug>, stop, passage', argumentHint: '[start <slug> | stop | passage]' })

    return next(e)
  })

  on('command.run', { command: 'autotask' }, async ($, e) => {
    const [verbe = '', ...reste] = e.args.trim().split(/\s+/)
    if (verbe === 'start') return { text: await demarrer(k, $, reste.join(' ')) }
    if (verbe === 'stop') {
      const avant = await read($, ETAT)
      if (!avant || avant.statut !== 'active') return { text: 'autotask : aucune mission active.' }
      const t = await $.clock.now()
      await changer($, x => ({ ...x, statut: 'arretee', fin: { heure: new Date(t).toISOString(), cause: 'commande /autotask stop' }, enCours: null, prochain: null }))
      await tracer($, k, avant.dossier, { heure: isoParis(t), type: 'stop', cause: 'commande /autotask stop' })

      return { text: `autotask : « ${avant.mission.titre} » arrêtée. Plus aucun passage.` }
    }
    if (verbe === 'passage') {
      const avant = await read($, ETAT)
      if (!avant || avant.statut !== 'active') return { text: 'autotask : aucune mission active.' }

      return { text: `autotask : ${await lancerPassage(k, $, cleMinute(await $.clock.now()), 'commande')}` }
    }
    if (verbe !== '' && verbe !== 'etat') return { text: 'usage : /autotask [start <slug> | stop | passage]' }
    ouvrirPane($)

    return { text: texteEtat(k, await read($, ETAT)) }
  })

  // ——— tours ———

  on('turn.start', async ($, e, next) => {
    const etat = await read($, ETAT)
    const c = etat?.enCours
    if (c && c.phase === 'tour' && !c.turnId && e.text.includes(`réf. ${c.ref}`)) await changer($, x => ({ ...x, enCours: x.enCours && x.enCours.ref === c.ref ? { ...x.enCours, turnId: e.turnId } : x.enCours }))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    // Chaque tour fini du manager prouve qu'il est vivant : l'heure (Paris) va dans <racine>/dernier-passage-manager.txt,
    // que lit la ligne « Manager » du tableau (sinon « muet » entre deux passages).
    void $.fs.write(`${k.racine}/dernier-passage-manager.txt`, `${isoParis(await $.clock.now())}\n`).catch(() => undefined)
    const etat = await read($, ETAT)
    const c = etat?.enCours
    if (!etat || !c || c.phase !== 'tour' || c.turnId !== e.turnId) return r
    try {
      const ligne = await finDeTour(k, $, etat, c, e.answer, e.reason !== 'answer')
      $.ui.log(ligne)

      return { ...r, text: r.text ? `${r.text}\n${ligne}` : ligne }
    } catch (err) {
      await changer($, x => ({ ...x, enCours: null }))
      $.ui.log(`autotask : vérification impossible (${err instanceof Error ? err.message : String(err)}) ; passage fermé.`)

      return r
    }
  })

  // ——— panneau ———

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const etat = await read($, ETAT)
    if (!etat)
      return (
        <Box flexDirection="column">
          <Text dimColor>Aucune mission. /autotask start &lt;slug&gt;</Text>
        </Box>
      )
    const m = etat.mission
    const r = etat.resultats
    const ligne = (id: string) => r[id]?.ligne ?? 'pas encore contrôlé'
    const statut =
      etat.statut === 'active'
        ? `prochain passage ${etat.prochain ? hhmm(Date.parse(etat.prochain)) : '—'}`
        : `${etat.statut === 'accomplie' ? 'accomplie' : 'arrêtée'} — ${etat.fin?.cause ?? ''}`
    const reprises = etat.enCours ? `${etat.enCours.reprises}/${k.reprisesMax} (en cours)` : etat.dernierPassage ? `${etat.dernierPassage.reprises}/${k.reprisesMax}` : `0/${k.reprisesMax}`
    const tache = (x: { id: string; titre: string }) => (
      <Box key={`t-${x.id}`} flexDirection="column">
        <Text {...couleur(r[x.id] ? (r[x.id]?.ok ? 'green' : 'red') : undefined)}>
          {r[x.id] ? (r[x.id]?.ok ? '✓' : '✗') : '·'} {x.id} {x.titre}
        </Text>
        <Text dimColor>{`  ${ligne(x.id)}`}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Text bold>{m.titre}</Text>
        <Text {...couleur(etat.statut === 'active' ? undefined : etat.statut === 'accomplie' ? 'green' : 'red')}>
          {statut}
        </Text>
        <Text dimColor>{`reprises : ${reprises}${etat.sautes ? ` · passages sautés : ${etat.sautes}` : ''}`}</Text>
        <Text bold>Arrêt</Text>
        {m.arret.map(a => (
          <Box key={`a-${a.id}`} flexDirection="column">
            <Text {...couleur(r[a.id]?.ok ? 'green' : undefined)}>
              {r[a.id]?.ok ? '■' : '□'} {a.id} {a.texte}
            </Text>
            <Text dimColor>{`  ${ligne(a.id)}`}</Text>
          </Box>
        ))}
        <Text bold>Monitoring</Text>
        {m.monitoring.map(tache)}
        <Text bold>Surveillance</Text>
        {m.surveillance.map(tache)}
      </Box>
    )
  })
}
