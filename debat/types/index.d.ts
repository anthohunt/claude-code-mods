export type Message = { side: 'POUR' | 'CONTRE' | 'AUTRE'; title: string; body: string }
export type Feed = { messages: Message[]; cadre: string; updatedAt: number; error: string | null; finished: string[] }
export type Fiche = { id: string; question: string; acquis: string; critere: string; faits: string; tours: string }
export type View = 'fiche' | 'fil'

declare module 'claude-code' {
  interface PluginState {
    debat: { feed: Feed; fiche: Fiche; current: string | null; view: View; launching: string | null }
  }
}
