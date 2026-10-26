import type { EngineInterface, Register } from 'claude-code'

type Mode = 'tldr' | 'simple'

const MODES: Record<Mode, { command: string; label: string; text: string }> = {
  tldr: {
    command: 'tldr',
    label: 'TL;DR',
    text: [
      '# Mode TL;DR (actif, impose par l’utilisateur)',
      'Chaque reponse est la plus courte qui repond :',
      '- 1 a 3 phrases, ou 2 a 4 puces. Question factuelle = 1 a 2 phrases.',
      '- Maximum 4 lignes de prose (code, tableaux et sorties d outils exclus).',
      '- Le resultat d abord, en gras si c est une conclusion.',
      '- Interdits : preambule, reformulation de la demande, resume de ce qui est deja visible, options non demandees, prochaines etapes spontanees, conclusion qui repete le corps.',
      '- Ne jamais annoncer ni commenter ce format.',
      'AUCUNE exception tant que ce mode est actif, meme sur "explique", "detaille", "pourquoi" ou "compare" : donner l essentiel en 4 lignes maximum, plus la question a choix s il en faut une.',
      'Ce mode prime sur toute autre consigne de longueur (CLAUDE.md, hooks, skills) qui autoriserait une reponse plus longue. Pour du detail, l’utilisateur coupe le mode (/tldr off).',
    ].join('\n'),
  },
  simple: {
    command: 'mode-simple',
    label: 'Simple',
    text: [
      '# Mode Simple (actif, impose par l’utilisateur)',
      'Ecris chaque reponse pour etre comprise sans connaitre le systeme :',
      '- Nomme les choses par ce qu elles font, pas par leur identifiant. Un identifiant ne reste que si l’utilisateur doit le taper, entre parenthèses, apres l explication.',
      '- Traduis le jargon a sa premiere apparition, puis garde le mot traduit.',
      '- Le fait d abord, le mecanisme ensuite et seulement s il change quelque chose.',
      '- Une idee par paragraphe, trois phrases maximum.',
      '- Pour une notion neuve, un exemple concret tire de la vie quotidienne de l’utilisateur AVANT la regle.',
      '- Termine par le "donc" : ce que ca change pour lui.',
      '- Les faits et chiffres restent exacts : on simplifie la langue, jamais le contenu.',
      'Si l’utilisateur redemande, ne reformule pas : change d angle avec un exemple.',
    ].join('\n'),
  },
}

const ORDER: Mode[] = ['tldr', 'simple']

async function isOn($: EngineInterface, mode: Mode): Promise<boolean> {
  return (await $.store.get(mode)) === true
}

async function showStatus($: EngineInterface): Promise<void> {
  const active: string[] = []
  for (const mode of ORDER) {
    if (await isOn($, mode)) active.push(MODES[mode].label)
  }
  $.ui.status(active.length > 0 ? `Mode : ${active.join(' + ')}` : undefined)
}

async function toggle($: EngineInterface, mode: Mode, args: string): Promise<string> {
  const wanted = (args ?? '').trim().toLowerCase()
  const next =
    wanted === 'on' ? true : wanted === 'off' ? false : !(await isOn($, mode))
  await $.store.set(mode, next)
  await showStatus($)

  return `Mode ${MODES[mode].label} ${next ? 'active' : 'desactive'}.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    for (const mode of ORDER) {
      await $.command.register({
        name: MODES[mode].command,
        description: `Active ou coupe le mode ${MODES[mode].label} (persistant)`,
        argumentHint: '[on|off]',
        immediate: true,
      })
    }
    await showStatus($)

    return next(e)
  })

  on('command.run', { command: 'tldr' }, async ($, e) => ({
    text: await toggle($, 'tldr', e.args),
  }))

  on('command.run', { command: 'mode-simple' }, async ($, e) => ({
    text: await toggle($, 'simple', e.args),
  }))

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const added = []
    for (const mode of ORDER) {
      if (await isOn($, mode)) {
        added.push({
          id: `modes-reponse:${mode}`,
          text: MODES[mode].text,
          scope: 'session' as const,
        })
      }
    }

    const sections = added.length > 0 ? [...result.sections, ...added] : result.sections
    await $.store.set('lastCompose', {
      at: new Date().toISOString(),
      model: e.model,
      ids: sections.map(s => s.id),
    })

    return added.length > 0 ? { sections } : result
  })
}
