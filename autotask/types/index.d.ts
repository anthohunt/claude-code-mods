/** Un critère d'arrêt de mission.json : son script dit OK → la mission s'arrête. */
export type AutotaskV2Arret = {
  id: string
  texte: string
  /** Exécutable (chemin relatif au dossier de la mission, ou absolu), lancé par `bash -c` dans ce dossier. */
  controle: string
  /** L'état final quand ce critère dit OK : « accomplie » (but atteint) ou « arretee » (échec). Défaut : « arretee ». */
  issue?: 'accomplie' | 'arretee'
}

/** Une tâche de monitoring ou de surveillance. */
export type AutotaskV2Tache = {
  id: string
  titre: string
  attendu: string
  controle: string
  si_ko: string
}

/** Une ligne du format de réponse imposé. */
export type AutotaskV2Ligne = {
  cle: string
  modele: string
  /** Les marques ✓/✗ de ces tâches sont cherchées dans cette ligne (sinon dans toute la réponse). */
  taches?: 'monitoring' | 'surveillance'
  /** Expression régulière que le contenu de la ligne (après « cle : ») doit vérifier. */
  motif?: string
}

/** mission.json, validé. */
export type AutotaskV2Mission = {
  titre: string
  mission: string
  /** Minutes de passage dans l'heure (heure de Paris), 0 à 59. */
  frequence: number[]
  arret: AutotaskV2Arret[]
  monitoring: AutotaskV2Tache[]
  surveillance: AutotaskV2Tache[]
  reponse: AutotaskV2Ligne[]
}

/** Ce qu'a dit un script : sa dernière ligne, son code, et OK seulement si « OK… » et code 0. */
export type AutotaskV2Resultat = {
  ok: boolean
  /** La ligne retenue (« OK … » / « KO … »), ou le KO construit par le mod. */
  ligne: string
  /** Le fait mesuré : la ligne sans son OK/KO de tête. */
  fait: string
  code: number | null
  /** Heure ISO du lancement. */
  heure: string
  ms: number
}

/** Le passage en cours (un seul à la fois). */
export type AutotaskV2EnCours = {
  /** Clé de la minute prévue (heure de Paris, « AAAA-MM-JJ HH:MM »). */
  cle: string
  /** Référence du message en attente de son tour (« <slug>/<AAAAMMJJ-HHMM>/r<n> »). */
  ref: string
  /** preparation : arrêts contrôlés avant le réveil ; tour : message envoyé, on attend la fin du tour ; verification : scripts en cours. */
  phase: 'preparation' | 'tour' | 'verification'
  /** Reprises déjà envoyées dans ce passage. */
  reprises: number
  /** Heure ISO de début du passage, puis de la dernière phase. */
  debut: string
  depuis: string
  turnId?: string
  declencheur: 'horaire' | 'commande'
}

export type AutotaskV2Conformite = {
  conforme: boolean
  /** Ce qui manque, une phrase par point. */
  manques: string[]
}

/** L'état de la mission active dans la session (et dans <slug>/etat.json). */
export type AutotaskV2Etat = {
  slug: string
  dossier: string
  mission: AutotaskV2Mission
  statut: 'active' | 'accomplie' | 'arretee'
  /** Pourquoi elle n'est plus active. */
  fin?: { heure: string; cause: string; critere?: string; ligne?: string }
  depuis: string
  prochain: string | null
  /** Clé de la dernière minute prévue déjà traitée. */
  dernierCle: string | null
  enCours: AutotaskV2EnCours | null
  /** Dernier résultat de chaque script, par id (arrêts, monitoring, surveillance). */
  resultats: Record<string, AutotaskV2Resultat>
  dernierPassage: {
    cle: string
    heure: string
    /** ok : tout OK et réponse conforme ; reprise : reprise envoyée ; borne : reprises épuisées ; interrompu ; arret. */
    issue: 'ok' | 'reprise' | 'borne' | 'interrompu' | 'arret' | 'abandon'
    reprises: number
    conformite: AutotaskV2Conformite | null
  } | null
  /** Passages sautés parce qu'un autre était en cours. */
  sautes: number
}

declare module 'claude-code' {
  interface PluginState {
    'autotask-v2': {
      /** La mission de la session (active ou terminée), sinon null. */
      etat: AutotaskV2Etat | null
    }
  }
}
