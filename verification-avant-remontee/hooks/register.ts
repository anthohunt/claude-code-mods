import type { Register } from 'claude-code'

// Check before reporting: no wrong or premature answer should reach the user. At the end of each turn where the
// session announces a result, a fresh agent that did none of the work checks the claims by itself, read-only;
// if it disputes one, the session is prompted to correct it and say so. The original answer stays on screen:
// the correction follows right after.

const MARQUEUR = '[Verification avant remontee]'
// One check, at most one correction, then the user checks for themself
const MAX_CORRECTIONS = 1
const AFFIRME = /\b(c['’]est fait|fait\s*:|termin[ée]|fini|pr[eê]te?s?|livrable|corrig[ée]|r[ée]par[ée]|r[ée]gl[ée]|install[ée]|publi[ée]|d[ée]ploy[ée]|en ligne|fonctionne|marche|v[ée]rifi[ée]|test[ée]|r[ée]ussi|valid[ée]|envoy[ée]|ferm[ée]|relanc[ée]|lanc[ée]|archiv[ée]|supprim[ée])\b/i

export function aVerifier(answer: string): boolean {
  const texte = answer.trim()
  if (texte.length < 160) return false // accuse de reception, une ligne de suivi
  if (texte.includes(MARQUEUR)) return false
  return AFFIRME.test(texte)
}

export function verdict(rapport: string): { conteste: boolean; motifs: string } {
  const m = rapport.match(/VERDICT-REMONTEE\s*:\s*(OK|CONTESTE)/i)
  const conteste = !!m && m[1].toUpperCase() === 'CONTESTE'
  const motifs = rapport.split(/VERDICT-REMONTEE\s*:\s*(?:OK|CONTESTE)/i)[1]?.trim() ?? ''
  return { conteste, motifs: motifs.slice(0, 3000) }
}

const CONSIGNE_VERIFICATEUR = [
  'Tu es un verificateur neuf et adverse. Tu n as rien fait de ce travail et tu ne fais confiance a rien de ce qui est affirme.',
  'On te donne le dernier message qu une session de travail vient d envoyer a l utilisateur. Releve chaque affirmation de fait qui compte pour lui',
  '(« c est fait », « ca marche », « verifie », un chiffre, un etat de machine, un fichier ecrit, un service en ligne, un envoi) et verifie-la toi-meme',
  'avec tes outils, en LECTURE SEULE : lire des fichiers, lancer des commandes qui ne changent rien (ls, cat, grep, git log, curl en GET, systemctl status...),',
  'ouvrir une page. Ne modifie, ne relance, ne ferme, n envoie et n efface jamais rien.',
  'Ce que tu ne peux pas verifier d ici (autre machine injoignable, ecran de l utilisateur, gout) n est pas une contestation : note-le comme non verifiable.',
  'Conteste seulement ce que tes constats contredisent, ou une affirmation « verifie/fait » sans aucune trace la ou elle devrait en laisser.',
  'Termine par une ligne exactement « VERDICT-REMONTEE: OK » ou « VERDICT-REMONTEE: CONTESTE », puis, si CONTESTE, chaque affirmation contestee avec ce que tu as constate (commande et resultat).',
].join('\n')

export const register: Register = on => {
  // verifications lancees et pas encore revenues, avec le nombre de corrections deja demandees dans la chaine ;
  // le retour se reconnait a son jeton VERDICT-REMONTEE (l id d un agent n est connu que du moteur)
  const enCours: number[] = []
  let corrections = 0
  let tourDeCorrection = false

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.agent.register({
      name: 'verificateur',
      description: 'Verificateur neuf et adverse des affirmations d un message (lecture seule). Lance par le mod, pas par le modele.',
      prompt: CONSIGNE_VERIFICATEUR,
      tools: ['Read', 'Grep', 'Glob', 'Bash', 'WebFetch'],
      model: 'opus',
    }).catch(() => undefined)
    return r
  })

  // le modele ne doit pas lancer ce verificateur lui-meme
  on('agent.offer', async ($, e, next) => (e.agent.endsWith(':verificateur') ? { isOffered: false } : next(e)))

  on('turn.start', async ($, e, next) => {
    // un message tape par l utilisateur remet le compteur a zero ; nos propres relances ne le font pas
    tourDeCorrection = e.text.includes(MARQUEUR)
    if (!tourDeCorrection) corrections = 0
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.reason !== 'answer') return result

    // retour d un de nos verificateurs
    if (e.agentId) {
      if (!enCours.length || !/VERDICT-REMONTEE\s*:/i.test(e.answer)) return result
      const deja = enCours.shift() as number
      const { conteste, motifs } = verdict(e.answer)
      if (!conteste) {
        $.ui.status('Verification : OK')
        return result
      }
      if (deja >= MAX_CORRECTIONS) {
        $.ui.toast('Verification : deja corrigee une fois, l utilisateur tranche')
        return result
      }
      corrections = deja + 1
      await $.prompt.submit({
        text:
          `${MARQUEUR} Un verificateur neuf, qui n a pas fait ton travail, conteste ton dernier message a l utilisateur :\n\n${motifs}\n\n` +
          'Verifie par toi-meme. Si tu avais tort, corrige ce qui doit l etre, puis donne a l utilisateur en premier, en une ou deux lignes, ' +
          'ce qui etait faux et ce qui est vrai maintenant. Si le verificateur se trompe, dis-le en une ligne avec la preuve.',
        wait: false,
      }).catch(() => undefined)
      return result
    }

    // la reponse a une contestation n est pas reverifiee : l utilisateur verifie ensuite lui-meme
    if (tourDeCorrection || !aVerifier(e.answer)) return result
    const lance = await $.agent.spawn({
      subagentType: 'verification-avant-remontee:verificateur',
      description: 'Verification avant remontee',
      prompt: `Message envoye a l utilisateur a verifier :\n\n<<<\n${e.answer.slice(0, 12000)}\n>>>`,
    }).catch(() => undefined)
    if (lance && !('deny' in lance && lance.deny)) {
      enCours.push(corrections)
      $.ui.status('Verification en cours par un agent neuf')
    }
    return result
  })
}
