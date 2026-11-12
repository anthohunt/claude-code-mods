import { expect, test } from 'claude-code/testing'
import { aVerifier, verdict } from './register'

test('un accuse de reception court n est pas verifie', () => {
  expect(aVerifier('Compris, je regarde.')).toBe(false)
})

test('une annonce de resultat est verifiee', () => {
  const m = 'J ai ferme la session Rapport et verifie que son programme est arrete. ' + 'Detail. '.repeat(30)
  expect(aVerifier(m)).toBe(true)
})

test('nos propres relances ne sont pas re-verifiees', () => {
  expect(aVerifier('[Verification avant remontee] c est fait ' + 'x'.repeat(300))).toBe(false)
})

test('lecture du verdict', () => {
  expect(verdict('constats...\nVERDICT-REMONTEE: OK').conteste).toBe(false)
  const v = verdict('...\nVERDICT-REMONTEE: CONTESTE\n- « service en ligne » : curl renvoie 502')
  expect(v.conteste).toBe(true)
  expect(v.motifs).toContain('502')
  expect(verdict('pas de verdict').conteste).toBe(false)
})

test('chaine complete : verificateur lance, contestation -> relance de la session', async ($, on) => {
  const soumis: string[] = []
  const lances: string[] = []
  on('agent.register', () => ({ value: { agent: 'verification-avant-remontee:verificateur' } }))
  on('agent.spawn', (_$: unknown, e: { subagentType?: string }) => { lances.push(String((e as any).subagentType ?? (e as any).subagent_type)); return { model: 'opus', agentId: 'v1' } })
  on('prompt.submit', (_$: unknown, e: { text: string }) => { soumis.push(e.text); return { text: e.text } })
  const statuts: string[] = []
  on('ui.status', (_$: unknown, e: any) => { statuts.push(JSON.stringify(e)); return { value: undefined } })
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never).catch(() => undefined)
  const annonce = 'C est fait : la page est en ligne et verifiee. ' + 'Detail. '.repeat(30)
  await $.turn.complete({ answer: annonce, reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' } as never)
  expect(lances).toEqual(['verification-avant-remontee:verificateur'])
  await $.turn.complete({ answer: 'VERDICT-REMONTEE: CONTESTE\n- page : curl renvoie 502', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't2', agentId: 'v1' } as never)
  expect(soumis.length).toBe(1)
  expect(soumis[0]).toContain('502')
})
