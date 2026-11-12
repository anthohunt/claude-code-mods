import { expect, test } from 'claude-code/testing'
import { lireDecisions } from './register'

const fichiers: Record<string, string> = { '/b/decisions.md': '- never send a test to the user' }
const exists = async (p: string) => p in fichiers
const read = async (p: string) => fichiers[p]

test('the first existing file is read', async () => {
  expect(await lireDecisions(['/a/decisions.md', '/b/decisions.md'], exists, read)).toContain('never send a test')
})

test('no file: nothing is added', async () => {
  expect(await lireDecisions(['/a/decisions.md'], exists, read)).toBeUndefined()
})

test('a long file keeps its end (newest decisions)', async () => {
  fichiers['/c/long.md'] = 'old '.repeat(3000) + 'NEWEST'
  const t = await lireDecisions(['/c/long.md'], exists, read)
  expect(t?.endsWith('NEWEST')).toBe(true)
  expect((t ?? '').length).toBe(6000)
})
