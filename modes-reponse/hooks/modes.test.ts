import { expect, mock, test } from 'claude-code/testing'

const BASE = { sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }
const INPUT = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] }

test('aucun mode actif : le prompt systeme reste tel quel', async ($, on) => {
  mock.store(on)
  on('prompt.compose', () => BASE)
  const ids = (await $.prompt.compose(INPUT)).sections.map(s => s.id)
  expect(ids).toEqual(['intro'])
})

test('modes actifs : les deux consignes sont ajoutees a la fin', async ($, on) => {
  mock.store(on, { tldr: true, simple: true })
  on('prompt.compose', () => BASE)
  const ids = (await $.prompt.compose(INPUT)).sections.map(s => s.id)
  expect(ids).toEqual(['intro', 'modes-reponse:tldr', 'modes-reponse:simple'])
})

test('/tldr bascule le mode, /tldr off le coupe', async ($, on) => {
  mock.store(on)
  on('prompt.compose', () => BASE)
  const first = await $.command.run({ command: 'tldr', args: '' })
  expect(first.text).toBe('Mode TL;DR active.')
  expect((await $.prompt.compose(INPUT)).sections.map(s => s.id)).toEqual([
    'intro',
    'modes-reponse:tldr',
  ])
  const off = await $.command.run({ command: 'tldr', args: 'off' })
  expect(off.text).toBe('Mode TL;DR desactive.')
  expect((await $.prompt.compose(INPUT)).sections.map(s => s.id)).toEqual(['intro'])
})
