export type Tache = {
  slug: string
  statut: string
  coches: number
  total: number
  criteres: { id: string; coche: boolean }[]
  dernier: string
  modifieMs: number
}

declare module 'claude-code' {
  interface PluginState {
    'taches-autonomes': { taches: Tache[]; lueA: number }
  }
}
