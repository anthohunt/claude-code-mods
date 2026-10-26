/** Types du mod campagne (campagne.json, relevé, état de la session manager). */
export type Obligation = { id: string; titre: string; attendu: string; controle: string; si_ko: string }
export type Campagne = {
  titre: string
  but: string
  ou: string
  cadence_min: number
  releve: string
  interdits: string
  arret: { texte: string; controle: string }
  obligations: Obligation[]
}
export type Tache = { id: string; titre: string; poste: string; attend: string; statut: string; phase: string; jugees: number; refus: number; dernier: string; activite_min: number | null }
export type Releve = {
  at?: string
  erreur?: string
  taches?: Tache[]
  demandes?: { fichier: string; age_min: number }[]
  services?: Record<string, string>
  gel?: string
  pont?: string
  agents?: number
  disque_go?: number
  verdicts?: number
  dernier_verdict?: { quand: string; tache: string; verdict: string } | null
  journal?: string[]
}
export type Question = { id: string; de: string; question: string; depuis: string; demande?: string; statut?: string }
export type Resultat = { ok: boolean; ligne: string }
export type EnCours = { ref: string; debut: string; depuis: string; reprises: number; turnId?: string; phase: 'tour' | 'verification' }
export type Etat = {
  slug: string
  dossier: string
  c: Campagne
  statut: 'active' | 'arretee' | 'accomplie'
  depuis: string
  prochain: string | null
  dernierCle: string | null
  releve: Releve | null
  questions: Question[]
  resultats: Record<string, Resultat>
  enCours: EnCours | null
  dernierPassage: { heure: string; issue: 'ok' | 'reprise' | 'borne' | 'interrompu' | 'abandon'; ko: string[] } | null
  passages: number
  fin?: string
}

declare module 'claude-code' {
  interface PluginState {
    campagne: {
      /** La campagne dont cette session est le manager (active ou terminée), sinon null. */
      etat: Etat | null
    }
  }
}
