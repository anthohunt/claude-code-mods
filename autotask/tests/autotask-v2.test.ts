import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { lireSortie } from '../hooks/controle'
import { validerMission } from '../hooks/mission'
import { cleMinute, hhmm, prochainPassage } from '../hooks/temps'
import { messageReveil, verifierReponse } from '../hooks/textes'

const RACINE = '/autotask'
const DOSSIER = `${RACINE}/demo`
const OPTIONS = { racine: RACINE, delaiControle: '120', reprisesMax: '5' }
/** 07/10/2026 17:50:30 à Paris (CEST). */
const DEBUT = Date.parse('2026-10-07T15:50:30Z')
const MIN = 60_000

const MISSION = {
  titre: 'Démo',
  mission: 'Garder le disque sain',
  frequence: [52, 7, 22, 37],
  arret: [
    { id: 'A1', texte: 'le disque est livré', controle: 'controles/a1.sh', issue: 'accomplie' },
    { id: 'A2', texte: 'deux échecs d’affilée', controle: 'controles/a2.sh' },
  ],
  monitoring: [{ id: 'M1', titre: 'Le disque', attendu: 'moins de 95 %', controle: 'controles/m1.sh', si_ko: 'faire de la place' }],
  surveillance: [{ id: 'S1', titre: 'Les lots', attendu: 'aucun bloqué', controle: 'controles/s1.sh', si_ko: 'relancer le lot' }],
  reponse: [
    { cle: 'Mission', modele: '<où on en est> · arrêt le plus proche : <critère>' },
    { cle: 'Monitoring', modele: '✓/✗ <id> <fait> pour chaque tâche', taches: 'monitoring' },
    { cle: 'Surveillance', modele: '✓/✗ <id> <fait> pour chaque tâche', taches: 'surveillance' },
    { cle: 'Pour toi', modele: 'rien, ou une seule question', motif: '^(rien|[^?]*\\?)$' },
  ],
}
const JSON_MISSION = JSON.stringify(MISSION)

describe('mission.json', () => {
  test('une mission complète est acceptée, minutes triées', () => {
    const v = validerMission(JSON_MISSION)
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.mission.frequence).toEqual([7, 22, 37, 52])
      expect(v.mission.arret[0]?.issue).toBe('accomplie')
    }
  })

  test('refus clair : champ inconnu, minute hors bornes, id en double, réponse vide, motif invalide, JSON cassé', () => {
    const v = validerMission(
      JSON.stringify({ ...MISSION, couleur: 'bleu', frequence: [7, 61], surveillance: [{ ...MISSION.surveillance[0], id: 'M1' }], reponse: [] }),
    )
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.erreurs).toContain('champ inconnu « couleur »')
      expect(v.erreurs).toContain('« frequence » : 61 n\'est pas une minute 0 à 59')
      expect(v.erreurs).toContain('surveillance[0] : id « M1 » en double')
      expect(v.erreurs).toContain('« reponse » : au moins un élément')
    }
    const m = validerMission(JSON.stringify({ ...MISSION, reponse: [{ cle: 'X', modele: 'y', motif: '(' }], monitoring: [{ id: 'M9', titre: 'x' }] }))
    expect(m.ok).toBe(false)
    if (!m.ok) {
      expect(m.erreurs).toContain('reponse[0] : « motif » n\'est pas une expression régulière valide')
      expect(m.erreurs).toContain('monitoring[0] : « attendu » texte non vide attendu')
    }
    const j = validerMission('{ pas du json')
    expect(j.ok).toBe(false)
  })
})

describe('heure de Paris', () => {
  test('prochain passage à la minute de Paris, été comme hiver, passage d’heure compris', () => {
    expect(hhmm(DEBUT)).toBe('17 h 50')
    expect(new Date(prochainPassage([7, 22, 37, 52], DEBUT)).toISOString()).toBe('2026-10-07T15:52:00.000Z')
    expect(new Date(prochainPassage([7, 22, 37, 52], Date.parse('2026-10-07T15:52:00Z'))).toISOString()).toBe('2026-10-07T16:07:00.000Z')
    expect(cleMinute(Date.parse('2026-10-07T15:52:10Z'))).toBe('2026-10-07 17:52')
    // Hiver : UTC+1.
    expect(hhmm(Date.parse('2026-12-01T10:22:00Z'))).toBe('11 h 22')
    // Le 25/10/2026 à 01:00 UTC, Paris repasse de 03:00 à 02:00.
    expect(hhmm(Date.parse('2026-10-25T00:59:00Z'))).toBe('02 h 59')
    expect(hhmm(Date.parse('2026-10-25T01:00:00Z'))).toBe('02 h 00')
    expect(hhmm(Date.parse('2026-03-29T01:00:00Z'))).toBe('03 h 00')
  })
})

describe('scripts de contrôle', () => {
  test('dernière ligne OK/KO ; OK seulement avec le code 0 ; sinon KO expliqué', () => {
    expect(lireSortie({ exitCode: 0, stdout: 'bavard\nOK 42 % occupé\n', stderr: '' })).toEqual({ ok: true, ligne: 'OK 42 % occupé', fait: '42 % occupé', code: 0 })
    expect(lireSortie({ exitCode: 1, stdout: 'KO 97 % occupé\n', stderr: '' }).ok).toBe(false)
    const menteur = lireSortie({ exitCode: 3, stdout: 'OK tout va bien\n', stderr: '' })
    expect(menteur.ok).toBe(false)
    expect(menteur.ligne).toBe('KO (code de sortie 3) OK tout va bien')
    expect(lireSortie({ exitCode: 2, stdout: '', stderr: 'ssh: timeout' }).ligne).toBe("KO le script n'a pas dit OK/KO (code 2) : ssh: timeout")
    expect(lireSortie({ exitCode: 0, stdout: 'OKAY\n', stderr: '' }).ok).toBe(false)
  })
})

const RES = (ok: boolean, fait: string) => ({ ok, ligne: `${ok ? 'OK' : 'KO'} ${fait}`, fait, code: ok ? 0 : 1, heure: '', ms: 1 })

describe('réveil et réponse', () => {
  const v = validerMission(JSON_MISSION)
  const m = v.ok ? v.mission : (undefined as never)

  test('le message de réveil : en-tête, mission, arrêts, monitoring puis surveillance, format exact', () => {
    const t = messageReveil({ mission: m, dossier: DOSSIER, ref: 'demo/20261007-1752/r0', heure: '17 h 52', resultats: { A1: RES(false, 'pas livré') } })
    const l = t.split('\n')
    expect(l[0]).toBe('[autotask] Démo — passage de 17 h 52')
    expect(l[1]).toBe('réf. demo/20261007-1752/r0')
    expect(t).toContain('Mission : Garder le disque sain')
    expect(t).toContain('- [A1] le disque est livré — `controles/a1.sh` : KO pas livré')
    expect(t).toContain('- [A2] deux échecs d’affilée — `controles/a2.sh` : pas encore contrôlé')
    expect(t).toContain(`- [STOP] fichier ${DOSSIER}/STOP : absent`)
    expect(t.indexOf('[M1] Le disque')).toBeLessThan(t.indexOf('[S1] Les lots'))
    expect(t).toContain('   si KO : faire de la place')
    expect(t).toContain("**Pour toi** : rien, ou une seule question")
    expect(t).toContain('**Mission** : <où on en est> · arrêt le plus proche : <critère>')
  })

  const r = { M1: RES(true, '42 % occupé'), S1: RES(false, 'lot conf-x bloqué depuis 12 min') }

  test('réponse conforme : chaque ligne, marques = scripts, faits repris (les nombres peuvent bouger)', () => {
    const ok = verifierReponse(
      m,
      ['**Mission** : en cours · arrêt le plus proche : A1', 'Monitoring : ✓ M1 43 % occupé', 'Surveillance : ✗ S1 lot conf-x bloqué depuis 13 min', 'Pour toi : rien'].join('\n'),
      r,
    )
    expect(ok).toEqual({ conforme: true, manques: [] })
  })

  test('réponse aérée : clés en gras, une tâche par ligne sous son titre, lignes vides', () => {
    const ok = verifierReponse(
      m,
      ['**Mission** : en cours · arrêt le plus proche : A1', '', '**Monitoring**', '✓ **M1** 43 % occupé', '', '**Surveillance**', '✗ **S1** lot conf-x bloqué depuis 13 min', '', '**Pour toi** : rien'].join('\n'),
      r,
    )
    expect(ok).toEqual({ conforme: true, manques: [] })
  })

  test('réponse incomplète : ligne absente, marque absente, question multiple', () => {
    const c = verifierReponse(m, ['Mission : en cours', 'Monitoring : rien à signaler', 'Pour toi : quoi ? et ça ?'].join('\n'), r)
    expect(c.conforme).toBe(false)
    expect(c.manques).toContain('ligne « Surveillance : … » absente')
    expect(c.manques).toContain('[M1] marque absente dans la ligne de monitoring : écris « ✓ M1 42 % occupé »')
    expect(c.manques.some(x => x.startsWith('ligne « Pour toi » hors format'))).toBe(true)
  })

  test('réponse qui ment : ✓ alors que le script dit KO ; fait non repris', () => {
    const c = verifierReponse(m, ['Mission : ok', 'Monitoring : ✓ M1 tout va bien', 'Surveillance : ✓ S1 rien de bloqué', 'Pour toi : rien'].join('\n'), r)
    expect(c.conforme).toBe(false)
    expect(c.manques).toContain('[S1] ta réponse marque ✓ alors que le script dit « KO lot conf-x bloqué depuis 12 min » (✓ seulement si OK)')
    expect(c.manques).toContain('[M1] fait mesuré non repris : « 42 % occupé »')
  })
})

/** Le monde sous le mod : disque en mémoire, scripts simulés, prompts soumis. */
function monde(on: On) {
  const w = {
    fichiers: new Map<string, string>([[`${DOSSIER}/mission.json`, JSON_MISSION]]),
    scripts: new Map<string, string>([
      ['controles/a1.sh', 'KO pas livré'],
      ['controles/a2.sh', 'KO 0 échec'],
      ['controles/m1.sh', 'OK 42 % occupé'],
      ['controles/s1.sh', 'KO lot conf-x bloqué'],
    ]),
    soumis: [] as string[],
    lances: [] as string[],
    toasts: [] as string[],
  }
  for (const s of w.scripts.keys()) w.fichiers.set(`${DOSSIER}/${s}`, '#!/bin/bash')
  const horloge = mock.clock(on, { now: DEBUT })
  horlogeCourante = horloge
  journal = []
  on('fs.read', ($, e) => {
    const t = w.fichiers.get(e.path)

    return t === undefined ? { deny: `ENOENT: ${e.path}` } : { value: t }
  })
  on('fs.write', ($, e) => (w.fichiers.set(e.path, e.text), { value: undefined }))
  on('fs.exists', ($, e) => ({ value: w.fichiers.has(e.path) }))
  on('process.run', ($, e) => {
    if (String(e.argv[2]) === 'cat >> passages.jsonl') {
      const f = `${e.init?.cwd}/passages.jsonl`
      w.fichiers.set(f, `${w.fichiers.get(f) ?? ''}${e.init?.stdin ?? ''}`)

      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    const controle = String(e.argv[2])
    w.lances.push(controle)
    const sortie = w.scripts.get(controle) ?? ''

    return { value: { exitCode: sortie.startsWith('OK') ? 0 : 1, stdout: `${sortie}\n`, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.submit', ($, e) => (w.soumis.push(e.text), { text: e.text }))
  on('command.register', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', ($, e) => (w.toasts.push(String((e as { text?: string }).text ?? '')), { value: undefined }) as never)
  on('ui.log', ($, e) => (journal.push(String((e as { text?: string }).text ?? '')), { value: undefined }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))

  return { w, horloge }
}

const commande = (args: string) => ({ command: 'autotask', args, origin: { kind: 'composer' }, presentation: { fullscreen: false, columns: 120 } }) as never
const etat = (w: { fichiers: Map<string, string> }) => JSON.parse(w.fichiers.get(`${DOSSIER}/etat.json`) ?? 'null')
const passages = (w: { fichiers: Map<string, string> }) =>
  (w.fichiers.get(`${DOSSIER}/passages.jsonl`) ?? '')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l))
let tour = 0
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const repondre = async ($: any, texte: () => string, reponse: string) => {
  const turnId = `t${++tour}`
  dollar = $
  await vider(() => texte() !== '')
  await $.turn.start({ text: texte(), turnId })
  const avant = journal.length
  await $.turn.complete({ answer: reponse, durationMs: 1, isAborted: false, turnId, reason: 'answer' })
  await vider(() => journal.length > avant)

  return { text: journal.slice(avant).join('\n') }
}
/** Laisse arriver les prompts que le mod a soumis sans les attendre. */
/** Les lignes que le mod écrit dans le transcript ($.ui.log). */
let journal: string[] = []
let horlogeCourante: { settle: () => Promise<void> } | undefined
let dollar: any
const vider = async (cond: () => boolean = () => false) => {
  for (let i = 0; i < 30 && !cond(); i++) {
    await horlogeCourante?.settle()
    if (dollar) await dollar.command.run(commande('etat'))
  }
}
const MENSONGE = ['Mission : ok · arrêt le plus proche : A1', 'Monitoring : ✓ M1 42 % occupé', 'Surveillance : ✓ S1 rien', 'Pour toi : rien'].join('\n')

describe('le mod en marche', () => {
  test('tout tour fini du manager, passage ou non, écrit son heure de Paris (le tableau ne le croit plus muet)', { options: OPTIONS }, async ($, on) => {
    const { w } = monde(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.turn.start({ text: 'une question de l’utilisateur', turnId: 'libre-1' })
    await $.turn.complete({ answer: 'réponse', durationMs: 1, isAborted: false, turnId: 'libre-1', reason: 'answer' })
    for (let i = 0; i < 5 && !w.fichiers.has(`${RACINE}/dernier-passage-manager.txt`); i++) await new Promise(r => setTimeout(r, 5))
    expect(w.fichiers.get(`${RACINE}/dernier-passage-manager.txt`)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0[12]:00\n$/)
  })

  test('start → réveil à la minute de Paris → réponse qui ment → reprise ; puis conforme → passage fermé ; un passage n’en empile pas un autre', { options: OPTIONS }, async ($, on) => {
    const { w, horloge } = monde(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

    const refus = await $.command.run(commande('start absente'))
    expect(refus.text).toBe(`autotask : ${RACINE}/absente/mission.json introuvable.`)
    const d = await $.command.run(commande('start demo'))
    expect(d.text).toBe('autotask : « Démo » active, minutes :07 :22 :37 :52, prochain passage 17 h 52.')

    // Rien avant 17 h 52 ; au tic de 17 h 52, un réveil.
    await horloge.advance(MIN)
    expect(w.soumis).toEqual([])
    await horloge.advance(MIN)
    dollar = $
    await vider(() => w.soumis.length > 0)
    expect(w.toasts).toEqual([])
    expect(w.soumis.length).toBe(1)
    expect(w.soumis[0]?.split('\n')[0]).toBe('[autotask] Démo — passage de 17 h 52')
    expect(w.lances.sort()).toEqual(['controles/a1.sh', 'controles/a2.sh'])

    // Le tour du réveil : la réponse marque ✓ S1 alors que son script dit KO → reprise immédiate.
    await repondre($, () => w.soumis[0] ?? '', MENSONGE)
    expect(passages(w).at(-1)).toMatchObject({ type: 'passage', decision: 'reprise', suivante: 'demo/20261007-1752/r1' })
    expect(passages(w).at(-1).conformite.manques.length).toBe(2)
    expect(w.soumis.length).toBe(2)
    const reprise = w.soumis[1] ?? ''
    expect(reprise.split('\n')[0]).toBe('[autotask] Démo — reprise 1/5 du passage de 17 h 52')
    expect(reprise).toContain('- [S1] Les lots\n  sortie : KO lot conf-x bloqué\n  script : `controles/s1.sh`\n  si KO : relancer le lot')
    expect(reprise).toContain('- [S1] ta réponse marque ✓ alors que le script dit « KO lot conf-x bloqué » (✓ seulement si OK)')

    // Une minute prévue pendant la reprise : sautée, rien d'empilé.
    await horloge.set(Date.parse('2026-10-07T16:07:30Z'))
    expect(w.soumis.length).toBe(2)
    await vider()
    expect(etat(w).sautes).toBe(1)

    // Le lot est réparé et la réponse dit vrai → passage fermé, aucune reprise.
    w.scripts.set('controles/s1.sh', 'OK aucun lot bloqué')
    await repondre($, () => reprise, ['Mission : ok · arrêt le plus proche : A1', 'Monitoring : ✓ M1 42 % occupé', 'Surveillance : ✓ S1 aucun lot bloqué', 'Pour toi : rien'].join('\n'))
    expect(passages(w).at(-1)).toMatchObject({ type: 'reprise', decision: 'ok', conformite: { conforme: true, manques: [] } })
    expect(w.soumis.length).toBe(2)
    const e = etat(w)
    expect(e.enCours).toBeNull()
    expect(e.dernierPassage.issue).toBe('ok')
    expect(e.resultats.S1.ligne).toBe('OK aucun lot bloqué')
    expect(passages(w).map((p: { type: string; decision?: string }) => `${p.type}:${p.decision ?? ''}`)).toEqual(['start:', 'reveil:', 'passage:reprise', 'saute:', 'reprise:ok'])

    // Une réponse d'un tour ordinaire (pas un passage) n'est pas vérifiée.
    const n = passages(w).length
    await repondre($, () => 'bonjour', 'salut')
    expect(passages(w).length).toBe(n)

    const vue = await $.command.run(commande(''))
    expect(vue.text).toContain('autotask : « Démo » — active · prochain passage 07/10 18 h 22')
    expect(vue.text).toContain('  ✓ [S1] Les lots — OK aucun lot bloqué')
  })

  test('borne : au plus 5 reprises d’affilée, puis attente du passage suivant, écrite dans l’état', { options: OPTIONS }, async ($, on) => {
    const { w, horloge } = monde(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run(commande('start demo'))
    await horloge.advance(2 * MIN)
    dollar = $
    await vider(() => w.soumis.length > 0)
    expect((await $.command.run(commande('passage'))).text).toBe("autotask : un passage est déjà en cours (réf. demo/20261007-1752/r0) : rien d'empilé.")
    for (let i = 1; i <= 5; i++) {
      await repondre($, () => w.soumis.at(-1) ?? '', MENSONGE)
      expect(passages(w).at(-1)).toMatchObject({ decision: 'reprise', reprise: i - 1, suivante: `demo/20261007-1752/r${i}` })
    }
    expect(w.soumis.length).toBe(6)
    await repondre($, () => w.soumis.at(-1) ?? '', MENSONGE)
    expect(passages(w).at(-1)).toMatchObject({ decision: 'borne', reprise: 5 })
    expect(w.soumis.length).toBe(6)
    const e = etat(w)
    expect(e.enCours).toBeNull()
    expect(e.dernierPassage).toMatchObject({ issue: 'borne', reprises: 5 })
    expect(passages(w).at(-1)).toMatchObject({ decision: 'borne', note: "5 reprise(s) d'affilée : attente du passage suivant" })
  })

  test('arrêt sur critère en fin de tour : état « accomplie », dernier message, plus aucun passage', { options: OPTIONS }, async ($, on) => {
    const { w, horloge } = monde(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run(commande('start demo'))
    await horloge.advance(2 * MIN)
    dollar = $
    await vider(() => w.soumis.length > 0)
    w.scripts.set('controles/a1.sh', 'OK disque livré')
    await repondre($, () => w.soumis[0] ?? '', MENSONGE)
    expect(passages(w).at(-1)).toMatchObject({ type: 'arret', statut: 'accomplie', cause: '[A1] le disque est livré' })
    expect(w.soumis.length).toBe(2)
    expect(w.soumis[1]?.split('\n')[0]).toBe('[autotask] Démo — mission accomplie (17 h 52)')
    expect(w.soumis[1]).toContain('Arrêt : [A1] le disque est livré — script : « OK disque livré »')
    expect(etat(w)).toMatchObject({ statut: 'accomplie', enCours: null, prochain: null, fin: { critere: 'A1' } })
    await horloge.advance(60 * MIN)
    expect(w.soumis.length).toBe(2)
    expect((await $.command.run(commande('passage'))).text).toBe('autotask : aucune mission active.')
  })

  test('fichier STOP : la mission s’arrête au passage prévu, sans réveil ; un mission.json invalide est refusé', { options: OPTIONS }, async ($, on) => {
    const { w, horloge } = monde(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    w.fichiers.set(`${RACINE}/casse/mission.json`, JSON.stringify({ ...MISSION, frequence: [] }))
    expect((await $.command.run(commande('start casse'))).text).toBe(
      `autotask : ${RACINE}/casse/mission.json refusé (1 erreur(s)) :\n- « frequence » : liste non vide de minutes (0 à 59) attendue`,
    )
    await $.command.run(commande('start demo'))
    w.fichiers.set(`${DOSSIER}/STOP`, '')
    await horloge.advance(2 * MIN)
    dollar = $
    await vider(() => w.soumis.length > 0)
    expect(w.soumis.length).toBe(1)
    expect(w.soumis[0]?.split('\n')[0]).toBe('[autotask] Démo — mission arrêtée (17 h 52)')
    expect(etat(w)).toMatchObject({ statut: 'arretee', fin: { cause: 'fichier STOP' } })
    expect(w.lances).toEqual([])
  })

  test('le panneau montre la mission, les arrêts, chaque tâche ✓/✗ avec sa ligne, les reprises (terminal et desktop)', { options: OPTIONS }, async ($, on) => {
    const { w, horloge } = monde(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
    await $.command.run(commande('start demo'))
    await horloge.advance(2 * MIN)
    dollar = $
    await vider(() => w.soumis.length > 0)
    await repondre($, () => w.soumis[0] ?? '', MENSONGE)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({
        plugin: 'autotask-v2',
        surface,
        component: 'Pane',
        requestId: 'autotask-v2',
        viewport: { columns: 100, rows: 30 },
        props: { title: 'Autotask', isFocused: true, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 20 }, view: {} },
      } as never)
      expect(await ui.find({ type: 'Text', text: 'Démo' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /prochain passage 18 h 07/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /reprises : 1\/5/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /✗.*S1.*Les lots/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '  KO lot conf-x bloqué' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /□.*A1/ })).toBeDefined()
      await ui.unmount()
    }
  })
})
