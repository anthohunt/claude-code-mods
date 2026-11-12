import type { Register } from 'claude-code'

// Shared decisions: rules the user decided once and that must reach every session, on every machine.
// The user (or a manager session) writes them in one Markdown file, synced between machines by any means
// (git, Syncthing, a shared folder); this mod rereads the file at every request and adds it to the prompt,
// so a decision taken in one session reaches all the others without being repeated.
// Option `fichiers`: one or several paths separated by « ; », the first one that exists is used. « ~ » = home folder.
let FICHIERS = ['~/.claude/decisions-communes.md']
const MAX_CARACTERES = 6000

export async function lireDecisions(
  chemins: string[],
  exists: (p: string) => Promise<boolean>,
  read: (p: string) => Promise<string>,
): Promise<string | undefined> {
  for (const chemin of chemins) {
    if (!(await exists(chemin).catch(() => false))) continue
    const texte = (await read(chemin).catch(() => '')).trim()
    if (!texte) return undefined
    // newest decisions are at the bottom: keep the end if the file grows too long
    return texte.length > MAX_CARACTERES ? texte.slice(texte.length - MAX_CARACTERES) : texte
  }
  return undefined
}

export const register: Register = (on, options) => {
  if (options?.fichiers) FICHIERS = String(options.fichiers).split(';').map(s => s.trim()).filter(Boolean)
  let chemins: string[] | undefined
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    if (!chemins) {
      const maison = ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '').replace(/\\/g, '/')
      chemins = FICHIERS.map(f => (f.startsWith('~') ? maison + f.slice(1) : f))
    }
    const texte = await lireDecisions(chemins, p => $.fs.exists(p), p => $.fs.read(p) as Promise<string>)
    if (!texte) return result
    return {
      ...result,
      sections: [
        ...result.sections,
        {
          id: 'decisions-communes:liste',
          scope: 'session' as const,
          text:
            '# Decisions valid for every session\n' +
            'The user took them in another session; they apply here too, like the user\'s own instructions. ' +
            'An instruction the user gives directly in this session wins in case of conflict.\n\n' +
            texte,
        },
      ],
    }
  })
}
