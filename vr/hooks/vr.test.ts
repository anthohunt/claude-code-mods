import { expect, mock, test } from 'claude-code/testing'

const BASE = { sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }
const INPUT = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] }
const FLAG = '/home/t/.claude/vr-mode.flag'

// Un disque en memoire pour l'interrupteur du mode.
function disque(on: any, initial: Record<string, string> = {}) {
  const files: Record<string, string> = { ...initial }
  const k = (e: any) => String(e.path).replace(/\\/g, '/')  // chemins Windows normalises
  on('fs.exists', async (_$: any, e: any) => ({ value: k(e) in files }) as never)
  on('fs.read', async (_$: any, e: any) => ({ value: files[k(e)] }) as never)
  on('fs.write', async (_$: any, e: any) => { files[k(e)] = e.text; return { value: undefined } as never })
  return files
}

test('mode inactif (pas d interrupteur) : le prompt reste tel quel', async ($, on) => {
  mock.store(on); mock.env(on, { USERPROFILE: '/home/t' }); disque(on)
  on('prompt.compose', () => BASE)
  expect((await $.prompt.compose(INPUT)).sections.map(s => s.id)).toEqual(['intro'])
})

test('mode actif : le rappel VR est ajoute a la fin', async ($, on) => {
  mock.store(on); mock.env(on, { USERPROFILE: '/home/t' }); disque(on, { [FLAG]: '2026-10-19T15:00:00' })
  on('prompt.compose', () => BASE)
  const sections = (await $.prompt.compose(INPUT)).sections
  expect(sections.map(s => s.id)).toEqual(['intro', 'vr:rappel'])
  expect(sections[1].text).toContain('MULTIJOUEUR')
})

test('/vr off ecrit off et retire le rappel ; /vr on le remet', async ($, on) => {
  mock.store(on); mock.env(on, { USERPROFILE: '/home/t' }); on('ui.status', async () => ({ value: undefined }) as never)
  const files = disque(on, { [FLAG]: '2026-10-19T15:00:00' })
  on('prompt.compose', () => BASE)
  expect((await $.command.run({ command: 'vr', args: 'off' })).text).toContain('desactive')
  expect(files[FLAG]).toBe('off')
  expect((await $.prompt.compose(INPUT)).sections.map(s => s.id)).toEqual(['intro'])
  expect((await $.command.run({ command: 'vr', args: 'on' })).text).toContain('active')
  expect((await $.prompt.compose(INPUT)).sections.map(s => s.id)).toEqual(['intro', 'vr:rappel'])
  expect((await $.command.run({ command: 'vr', args: 'status' })).text).toBe('Mode VR actif.')
})
