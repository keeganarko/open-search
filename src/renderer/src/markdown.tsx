import type { JSX, ReactNode } from 'react'

/**
 * A small Markdown renderer. Deliberately not a full parser: it covers what the
 * model actually emits in chat (headings, lists, fenced code, emphasis, links)
 * and renders everything else as plain text. Nothing here builds HTML strings,
 * so page content that reaches the transcript cannot inject markup.
 */

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  // code | bold | italic | link
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)|(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const key = `${keyBase}-${i++}`
    if (m[1]) out.push(<code key={key}>{m[1].slice(1, -1)}</code>)
    else if (m[2]) out.push(<strong key={key}>{m[2].slice(2, -2)}</strong>)
    else if (m[3]) out.push(<em key={key}>{m[3].slice(1, -1)}</em>)
    else if (m[4]) {
      const label = m[4].slice(1, m[4].indexOf(']'))
      const href = m[5]
      out.push(
        <a
          key={key}
          href={href}
          onClick={(e) => { e.preventDefault(); window.voyager.openExternal(href) }}
        >{label}</a>
      )
    }
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }): JSX.Element {
  const blocks: ReactNode[] = []
  const lines = text.split('\n')
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++])
      i++
      blocks.push(
        <pre key={key++}><code data-lang={lang || undefined}>{body.join('\n')}</code></pre>
      )
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const Tag = `h${Math.min(3, heading[1].length)}` as 'h1' | 'h2' | 'h3'
      blocks.push(<Tag key={key++}>{inline(heading[2], `h${key}`)}</Tag>)
      i++
      continue
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''))
        i++
      }
      const kids = items.map((t, n) => <li key={n}>{inline(t, `li${key}-${n}`)}</li>)
      blocks.push(ordered ? <ol key={key++}>{kids}</ol> : <ul key={key++}>{kids}</ul>)
      continue
    }

    if (line.startsWith('> ')) {
      const body: string[] = []
      while (i < lines.length && lines[i].startsWith('> ')) body.push(lines[i++].slice(2))
      blocks.push(<blockquote key={key++}>{inline(body.join(' '), `bq${key}`)}</blockquote>)
      continue
    }

    if (!line.trim()) { i++; continue }

    const para: string[] = []
    while (
      i < lines.length && lines[i].trim() &&
      !lines[i].startsWith('```') && !/^#{1,4}\s/.test(lines[i]) &&
      !/^\s*([-*+]|\d+\.)\s+/.test(lines[i]) && !lines[i].startsWith('> ')
    ) para.push(lines[i++])
    blocks.push(<p key={key++}>{inline(para.join('\n'), `p${key}`)}</p>)
  }

  return <>{blocks}</>
}
