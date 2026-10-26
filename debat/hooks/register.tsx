import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Feed, Fiche, View } from '../types'
import { parse } from './parse'

const PANE = 'debat'
// Réglages (options du mod) : `hote` = machine SSH où tournent les débats (vide = cette machine),
// `racine` = dossier des débats, `lanceur` = commande qui crée un débat (lit la fiche JSON sur l'entrée standard).
let HOST = ''
let BASE = '~/debats'
let LANCEUR = 'python3 lancer-debat.py'
const EMPTY: Feed = { messages: [], cadre: '', updatedAt: 0, error: null, finished: [] }
const DRAFT: Fiche = {
  id: 'exemple-tests',
  question: "Pour un petit projet maintenu par deux personnes, faut-il exiger des tests automatiques avant chaque fusion ?",
  acquis: "Le projet est petit, deux personnes le maintiennent, le code est publié ; le temps de relecture est limité.",
  critere: "Le moins de défauts livrés par heure de travail passée, sur l'année qui vient.",
  faits: '',
  tours: '4',
}
const feed = atom({ plugin: 'debat', key: 'feed' } as const, EMPTY)
const fiche = atom({ plugin: 'debat', key: 'fiche' } as const, DRAFT)
const current = atom({ plugin: 'debat', key: 'current' } as const, null as string | null)
const view = atom({ plugin: 'debat', key: 'view' } as const, 'fiche' as View)
const launching = atom({ plugin: 'debat', key: 'launching' } as const, null as string | null)

// Exécute un script shell sur la machine des débats : en SSH si `hote` est donné, sinon ici.
function enShell(script: string, hote = HOST): string[] {
  return hote ? ['ssh', '-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes', hote, script] : ['bash', '-c', script]
}
// `~` au début d'un chemin : $HOME de la machine qui exécute le script (guillemets doubles dans le script).
const chemin = (p: string) => (p.startsWith('~') ? `$HOME${p.slice(1)}` : p)

async function refresh($: EngineInterface) {
  const id = await read($, current)
  await trace($, `refresh id=${id}`)
  if (!id) return
  const d = `${chemin(BASE)}/${id}`
  const script = `cat "${d}/cadre.md"; echo '@@C@@'; cat "${d}/debat.md"; echo '@@F@@'; for c in pour contre; do [ -f "${d}/$c.fin" ] && echo $c; done`
  try {
    const { exitCode, stdout, stderr } = await $.process.run(enShell(script), { timeoutMs: 25000 })
    const [cadre = '', rest = ''] = stdout.split('@@C@@')
    const [text = '', tail = ''] = rest.split('@@F@@')
    if (exitCode !== 0 && !text.trim()) throw new Error(stderr.trim() || `ssh code ${exitCode}`)
    const finished = tail.split(/\s+/).filter(Boolean)
    await trace($, `ssh exit=${exitCode} stdout=${stdout.length} messages=${parse(text).length} stderr=${stderr.slice(0, 200)}`)
    await update($, feed, () => ({ messages: parse(text), cadre: cadre.replace(/^## .*\n/, '').trim(), updatedAt: Date.now(), error: null, finished }))
  } catch (err) {
    await trace($, `erreur ${String((err as Error).message ?? err)}`)
    await update($, feed, f => ({ ...f, error: String((err as Error).message ?? err) }))
  }
}

async function trace($: EngineInterface, line: string) {
  // Sous Linux, un chemin « C:/… » écrit en dur devient un dossier relatif au cwd (il a fini commité dans le dépôt skills).
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (!home) return
  const path = `${home.replace(/\\/g, '/')}/.claude/dev-mods/debat-trace.log`
  let old = ''
  try { old = await $.fs.read(path) } catch { old = '' }
  try { await $.fs.write(path, `${old}${new Date().toISOString()} ${line}\n`.slice(-20000)) } catch { /* trace facultative */ }
}

async function launch($: EngineInterface) {
  const f = await read($, fiche)
  if (!f.question.trim() || !f.critere.trim()) {
    await update($, launching, () => 'La question et le critère pour trancher sont obligatoires.')
    return
  }
  await update($, launching, () => 'Lancement des deux agents…')
  try {
    const { exitCode, stdout, stderr } = await $.process.run(
      enShell(`DEBAT_RACINE="${chemin(BASE)}" ${LANCEUR}`),
      { stdin: JSON.stringify(f), timeoutMs: 120000 },
    )
    const id = /^id (\S+)/m.exec(stdout)?.[1]
    if (exitCode !== 0 || !id) throw new Error((stderr || stdout).trim() || `code ${exitCode}`)
    await update($, current, () => id)
    await update($, feed, () => EMPTY)
    await update($, view, () => 'fil' as View)
    await update($, launching, () => null)
    await refresh($)
  } catch (err) {
    await update($, launching, () => `Échec : ${String((err as Error).message ?? err)}`)
  }
}

async function setField($: EngineInterface, key: keyof Fiche, value: string) {
  await update($, fiche, f => ({ ...f, [key]: value }))
}

async function showView($: EngineInterface, next: View) {
  await update($, view, () => next)
}

export const register: Register = (on, options) => {
  HOST = String(options?.hote ?? '').trim()
  BASE = String(options?.racine ?? '~/debats').replace(/\/+$/, '')
  LANCEUR = String(options?.lanceur ?? 'python3 lancer-debat.py').trim()
  let timer: { cancel: () => void } | null = null

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'debat', description: 'Prépare un débat cadré entre deux agents, puis suis-le en interface chat' })
    // Un rechargement du module repart de zéro (variables comprises) : le minuteur repart ici, et ne lit le VPS
    // que lorsqu'un débat est en cours dans cette session.
    timer?.cancel()
    timer = $.clock.every(20000, () => refresh($))
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'debat' }, async ($, e) => {
    if (e.args.trim() === 'off') {
      timer?.cancel()
      timer = null
      await $.ui.close({ id: PANE })
      return { text: 'Pane du débat fermé.' }
    }
    await $.ui.open({ id: PANE, title: 'Débat' })
    await refresh($)
    if (!timer) timer = $.clock.every(20000, () => refresh($))
    const f = await read($, feed)
    const id = await read($, current)
    return { text: id ? `Pane du débat ouvert (${id} : ${f.messages.length} messages${f.error ? `, erreur : ${f.error}` : ''}).` : 'Pane du débat ouvert.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown, Button, Input } = $.ui.resolve(e)
    const mode = await read($, view)
    const id = await read($, current)

    if (mode === 'fiche' || !id) {
      const f = await read($, fiche)
      const status = await read($, launching)
      const field = (key: keyof Fiche, label: string, hint: string) => (
        <Box key={`b-${key}`} flexDirection="column">
          <Text weight="semibold">{label}</Text>
          <Text dimColor size="footnote">{hint}</Text>
          {Input && <Input key={key} value={f[key]} onInput={v => setField($, key, v)} onSubmit={v => setField($, key, v)} />}
        </Box>
      )
      const isError = !!status && (status.startsWith('Échec') || status.includes('obligatoires'))
      return (
        <Box flexDirection="column" gap={1} padding={1}>
          <Text weight="bold" size="heading">Cadre du débat</Text>
          <Text dimColor>Les deux agents doivent respecter cette fiche. Corrige-la, puis lance.</Text>
          {field('question', 'Question', 'Ce que les deux camps tranchent : POUR = oui, CONTRE = non')}
          {field('acquis', 'Cadre (acquis)', 'Ce qui ne se discute pas : aucun argument ne peut en sortir')}
          {field('critere', 'Critère pour trancher', 'Ce qui permet de dire qui a raison')}
          {field('faits', 'Faits partagés', 'Ce que les deux camps tiennent pour établi')}
          <Box flexDirection="row" gap={2}>
            {field('id', 'Nom du débat', 'minuscules et tirets')}
            {field('tours', 'Tours', '1 à 6')}
          </Box>
          <Box flexDirection="row" gap={2}>
            <Button key="launch" label="Lancer le débat" onPress={() => launch($)} />
            {id && <Button key="back" label="Revenir au fil" onPress={() => showView($, 'fil')} />}
          </Box>
          {status && <Text color={isError ? 'red' : undefined}>{status}</Text>}
        </Box>
      )
    }

    const f = await read($, feed)
    const time = f.updatedAt ? new Date(f.updatedAt).toLocaleTimeString('fr-FR') : 'jamais'
    const done = f.finished.length === 2
    const count = f.messages.filter(m => m.side !== 'AUTRE').length
    return (
      <Box flexDirection="column" gap={1} padding={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text weight="bold" size="heading">Débat : {id}</Text>
          <Box flexDirection="row" gap={1}>
            <Button key="refresh" label="Rafraîchir" onPress={() => refresh($)} />
            <Button key="new" label="Nouveau débat" onPress={() => showView($, 'fiche')} />
          </Box>
        </Box>
        {f.cadre && (
          <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
            <Markdown text={f.cadre} />
          </Box>
        )}
        <Text dimColor>
          {done ? 'Débat terminé' : `En cours · ${count} messages`} · mis à jour à {time}
        </Text>
        {f.error && <Text color="red">Lecture impossible : {f.error}</Text>}
        {f.messages.length === 0 && !f.error && <Text dimColor>En attente du premier message…</Text>}
        {f.messages.filter(m => m.side !== 'AUTRE').map((m, i) => {
          const isPour = m.side === 'POUR'
          return (
            <Box key={`m${i}`} flexDirection="column" alignSelf={isPour ? 'flex-start' : 'flex-end'} width="85%"
              borderStyle="round" borderColor={isPour ? 'green' : 'blue'} paddingX={1}>
              <Text weight="bold" color={isPour ? 'green' : 'blue'}>{isPour ? 'POUR' : 'CONTRE'} · {m.title}</Text>
              <Markdown text={m.body || '…'} />
            </Box>
          )
        })}
      </Box>
    )
  })
}
