import { expect, test } from 'claude-code/testing'

import { changements, lireFiche } from './fiche'

const FICHE = `---
slug: demo
statut: en cours
fixée: 2026-10-07
---

## But
Un but.

## Critères de réussite
- [x] C1 — premier · se vérifie par : x
- [ ] C2 — second · se vérifie par : y

## Journal
- 2026-10-06 22:00 — plus ancien
- 2026-10-07 10:00 — plus récent
`

test('une fiche donne statut, critères cochés et dernière ligne de journal', () => {
  const t = lireFiche(FICHE, 0)
  expect(t?.slug).toBe('demo')
  expect(t?.statut).toBe('en cours')
  expect([t?.coches, t?.total]).toEqual([1, 2])
  expect(t?.dernier).toBe('2026-10-07 10:00 — plus récent')
})

test('un fichier sans en-tête slug est ignoré', () => {
  expect(lireFiche('# Liste de situations\n', 0)).toBe(null)
})

test('un critère coché et un changement de statut sont signalés', () => {
  const avant = lireFiche(FICHE, 0)!
  const apres = lireFiche(FICHE.replace('- [ ] C2', '- [x] C2').replace('en cours', 'réussie'), 0)!
  expect(changements([avant], [apres])).toEqual(['demo : en cours → réussie', 'demo : C2 coché'])
})
