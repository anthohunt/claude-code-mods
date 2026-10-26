import type { Message } from '../types'

// Découpe le fichier du débat en messages : un titre « ## Tour N — POUR » ou « ## Position finale — CONTRE » ouvre un message.
export function parse(markdown: string): Message[] {
  const messages: Message[] = []
  let current: Message | null = null
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^## (.+)$/.exec(line)
    if (heading) {
      if (current) messages.push(current)
      const title = heading[1].trim()
      const side = /CONTRE\s*$/i.test(title) ? 'CONTRE' : /POUR\s*$/i.test(title) ? 'POUR' : 'AUTRE'
      current = { side, title: title.replace(/\s*[—-]\s*(POUR|CONTRE)\s*$/i, ''), body: '' }
    } else if (current) {
      current.body += line + '\n'
    }
  }
  if (current) messages.push(current)
  return messages.map(m => ({ ...m, body: m.body.trim() }))
}
