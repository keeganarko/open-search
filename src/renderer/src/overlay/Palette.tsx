import { useEffect, useRef, useState, type JSX } from 'react'
import type { HistoryEntry, Skill, TabState } from '@shared/types'

interface Cmd {
  id: string
  label: string
  detail?: string
  glyph: string
  run: () => void
}

export default function Palette({ query, onClose }: { query: string; onClose: () => void }): JSX.Element {
  const [q, setQ] = useState(query)
  const [tabs, setTabs] = useState<TabState[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => {
    void window.kia.layout.state().then((s) => setTabs(s.tabs))
    void window.kia.skills.list().then(setSkills)
  }, [])
  useEffect(() => {
    if (!q.trim()) return setHistory([])
    const t = setTimeout(() => { void window.kia.history.search(q, 5).then(setHistory) }, 100)
    return () => clearTimeout(t)
  }, [q])

  const go = (fn: () => void) => (): void => { fn(); onClose() }

  const commands: Cmd[] = [
    { id: 'new-tab', glyph: '+', label: 'New tab', run: go(() => window.kia.tabs.create({})) },
    { id: 'split', glyph: '◫', label: 'Split with the last tab', detail: 'Two pages side by side',
      run: go(async () => {
        const s = await window.kia.layout.state()
        const others = s.tabs.filter((t) => t.id !== s.activeTabId)
        if (s.activeTabId && others.length) {
          window.kia.layout.split([s.activeTabId, others[others.length - 1].id])
        }
      }) },
    { id: 'unsplit', glyph: '▭', label: 'Close split', run: go(() => window.kia.layout.clearSplit()) },
    { id: 'organize', glyph: '⁝', label: 'Organize my tabs into groups', detail: 'Open Search decides the groups',
      run: go(() => void window.kia.groups.autoOrganize()) },
    { id: 'tidy', glyph: '⌫', label: 'Tidy up idle tabs', run: () => window.kia.openPanel('tidy') },
    { id: 'sidebar', glyph: '◫', label: 'Toggle the Open Search sidebar', run: go(() => window.kia.layout.sidebar()) },
    { id: 'brief', glyph: '◔', label: 'Morning brief', run: () => window.kia.openPanel('brief') },
    { id: 'deck', glyph: '▤', label: 'Make a deck or a report', run: () => window.kia.openPanel('deck-composer') },
    { id: 'history', glyph: '🕘', label: 'History', run: () => window.kia.openPanel('history') },
    { id: 'memory', glyph: '◈', label: 'What Open Search remembers', run: () => window.kia.openPanel('memory') },
    { id: 'skills', glyph: '✧', label: 'Skills', run: () => window.kia.openPanel('skills') },
    { id: 'connectors', glyph: '⚯', label: 'Connectors', run: () => window.kia.openPanel('connectors') },
    { id: 'downloads', glyph: '⤓', label: 'Downloads', run: () => window.kia.openPanel('downloads') },
    { id: 'settings', glyph: '⚙', label: 'Settings', run: () => window.kia.openPanel('settings') },
    { id: 'bookmark', glyph: '☆', label: 'Bookmark this page',
      run: go(async () => {
        const s = await window.kia.layout.state()
        const t = s.tabs.find((x) => x.id === s.activeTabId)
        if (t) void window.kia.bookmarks.add(t.url, t.title)
      }) }
  ]

  const ql = q.trim().toLowerCase()
  const match = (s: string): boolean => !ql || s.toLowerCase().includes(ql)

  const rows: Cmd[] = [
    ...commands.filter((c) => match(c.label)),
    ...skills.filter((s) => match(s.slug) || match(s.name)).map((s) => ({
      id: `skill:${s.id}`, glyph: '✦', label: s.name, detail: `/${s.slug} — ${s.description}`,
      run: go(() => {
        window.kia.layout.sidebar(true)
        void window.kia.chat.send({ conversationId: null, text: '', attachments: [], skillSlug: s.slug })
      })
    })),
    ...tabs.filter((t) => match(t.title) || match(t.url)).slice(0, 6).map((t) => ({
      id: `tab:${t.id}`, glyph: '▢', label: t.title || t.url, detail: t.url,
      run: go(() => window.kia.tabs.activate(t.id))
    })),
    ...history.map((h) => ({
      id: `h:${h.id}`, glyph: '🕘', label: h.title || h.url, detail: h.url,
      run: go(() => window.kia.tabs.create({ url: h.url }))
    }))
  ]

  return (
    <div className="scrim top" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet">
        <div className="sheet-input">
          <span className="kind">Open Search</span>
          <input
            ref={input}
            value={q}
            placeholder="Type a command, a tab, or a skill…"
            onChange={(e) => { setQ(e.target.value); setSel(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % Math.max(1, rows.length)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + rows.length) % Math.max(1, rows.length)) }
              else if (e.key === 'Enter') { e.preventDefault(); rows[sel]?.run() }
            }}
          />
        </div>
        <div className="sheet-list">
          {rows.length === 0 && <div className="empty">Nothing matched.</div>}
          {rows.map((r, i) => (
            <button key={r.id} className={`sheet-row${i === sel ? ' sel' : ''}`}
              onMouseEnter={() => setSel(i)} onClick={r.run}>
              <span className="glyph">{r.glyph}</span>
              <span className="main">
                <span className="t">{r.label}</span>
                {r.detail && <span className="s">{r.detail}</span>}
              </span>
            </button>
          ))}
        </div>
        <div className="sheet-foot"><span>↑↓ move</span><span>↵ run</span><span>esc close</span></div>
      </div>
    </div>
  )
}
