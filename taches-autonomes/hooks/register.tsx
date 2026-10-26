import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Tache } from '../types'
import { changements, depuis, lireFiche, trier } from './fiche'

// Registre des fiches : ~/.claude/autonomous-tasks par défaut (option `registre`, « ~ » = dossier personnel).
let REGISTRE = '~/.claude/autonomous-tasks'
const PANNEAU = 'taches-autonomes'
const PERIODE_MS = 60_000
const SILENCE_MS = 30 * 60_000

const taches = atom({ plugin: 'taches-autonomes', key: 'taches' } as const, [])
const lueA = atom({ plugin: 'taches-autonomes', key: 'lueA' } as const, 0)

const COULEUR: Record<string, string> = {
  'en cours': 'cyan',
  'prête': 'green',
  brouillon: 'yellow',
  'réussie': 'green',
  'arrêtée': 'gray',
}

async function lireRegistre($: EngineInterface): Promise<Tache[]> {
  const entrees = await $.fs.list(REGISTRE)
  const lues: Tache[] = []
  for (const f of entrees) {
    if (f.kind !== 'file' || !f.name.endsWith('.md')) continue
    try {
      const t = lireFiche(await $.fs.read(`${REGISTRE}/${f.name}`), f.mtimeMs)
      if (t) lues.push(t)
    } catch {
      // fiche illisible ou trop grosse : ignoree, la suivante est lue
    }
  }

  return trier(lues)
}

let premiereLecture = true
const signalees = new Set<string>()

async function rafraichir($: EngineInterface): Promise<void> {
  const avant = await read($, taches)
  const apres = await lireRegistre($)
  const maintenant = await $.clock.now()

  if (!premiereLecture) {
    for (const note of changements(avant, apres)) $.ui.toast(note, { timeoutMs: 8000 })
  }
  premiereLecture = false

  for (const t of apres) {
    const muette = t.statut === 'en cours' && maintenant - t.modifieMs > SILENCE_MS
    if (muette && !signalees.has(t.slug)) {
      signalees.add(t.slug)
      $.ui.toast(`${t.slug} : rien d'écrit depuis ${depuis(maintenant - t.modifieMs)}`, {
        timeoutMs: 8000,
      })
    }
    if (!muette) signalees.delete(t.slug)
  }

  const enCours = apres.filter(t => t.statut === 'en cours').length
  $.ui.status(
    enCours === 0
      ? undefined
      : `Tâches : ${enCours} en cours` + (signalees.size > 0 ? ` · ${signalees.size} sans nouvelles` : ''),
  )

  await update($, taches, () => apres)
  await update($, lueA, () => maintenant)
}

export const register: Register = (on, options) => {
  if (options?.registre) REGISTRE = String(options.registre).replace(/\/+$/, '')
  on('session.start', async ($, e, next) => {
    if (REGISTRE.startsWith('~')) REGISTRE = `${((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')}${REGISTRE.slice(1)}`
    await $.command.register({
      name: 'taches',
      description: 'Ouvre le tableau de bord des tâches autonomes',
      immediate: true,
    })
    await rafraichir($).catch(() => undefined)
    $.clock.every(PERIODE_MS, () => {
      void rafraichir($).catch(() => undefined)
    })

    return next(e)
  })

  on('command.run', { command: 'taches' }, async $ => {
    await rafraichir($).catch(() => undefined)
    const ouvert = await $.ui.open({ id: PANNEAU, title: 'Tâches autonomes' })

    return { text: ouvert.isPlaced ? 'Tableau des tâches ouvert.' : 'Élargis la fenêtre pour voir le tableau.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANNEAU }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const liste = await read($, taches)
    const quand = await read($, lueA)
    const maintenant = quand || (await $.clock.now())

    const lancer = (slug: string) =>
      void $.prompt.submit({ text: `/launch-autonomous-task lance la tâche autonome ${slug}` })
    const arreter = (slug: string) =>
      void $.prompt.submit({ text: `/launch-autonomous-task arrête la tâche autonome ${slug}` })

    return (
      <Box flexDirection="column">
        {liste.length === 0 && <Text dimColor>Aucune tâche dans le registre.</Text>}
        {liste.map(t => {
          const fini = t.statut === 'réussie' || t.statut === 'arrêtée'
          const muette = t.statut === 'en cours' && maintenant - t.modifieMs > SILENCE_MS

          return (
            <Box key={`t:${t.slug}`} flexDirection="column" marginBottom={1}>
              <Text bold={!fini} dimColor={fini}>
                {t.slug} <Text color={COULEUR[t.statut] ?? 'white'}>{t.statut}</Text>
              </Text>
              {!fini && (
                <Text dimColor={!muette} color={muette ? 'yellow' : undefined}>
                  {t.total > 0 ? `Critères ${t.coches}/${t.total} · ` : ''}
                  fiche modifiée il y a {depuis(maintenant - t.modifieMs)}
                </Text>
              )}
              {!fini && t.dernier !== '' && (
                <Text dimColor wrap="truncate-end">
                  {t.dernier}
                </Text>
              )}
              {t.statut === 'prête' && (
                <Button key={`lancer:${t.slug}`} label="Lancer" onPress={() => lancer(t.slug)} />
              )}
              {t.statut === 'en cours' && (
                <Button key={`arreter:${t.slug}`} label="Arrêter" onPress={() => arreter(t.slug)} />
              )}
            </Box>
          )
        })}
        <Button key="rafraichir" label="Rafraîchir" onPress={() => void rafraichir($)} />
      </Box>
    )
  })
}
