import { expect, test } from 'claude-code/testing'
import { parse } from './parse'

test('découpe les tours et les camps', () => {
  const md = '# Débat\n\n## Tour 1 — POUR\nArgument A\n\n## Tour 1 — CONTRE\nRéponse B\n## Position finale — POUR\nFin'
  const m = parse(md)
  expect(m.length).toBe(3)
  expect(m[0]).toEqual({ side: 'POUR', title: 'Tour 1', body: 'Argument A' })
  expect(m[1].side).toBe('CONTRE')
  expect(m[2].title).toBe('Position finale')
})
