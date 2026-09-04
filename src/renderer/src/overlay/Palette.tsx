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
    void window.voyager.layout.state().then((s) => setTabs(s.tabs))
    void window.voyager.skills.list().then(setSkills)
  }, [])
  useEffect(() => {
    if (!q.trim()) return setHistory([])
    const t = setTimeout(() => { void window.voyager.history.search(q, 5).then(setHistory) }, 100)
    return () => clearTimeout(t)
  }, [q])

  const go = (fn: () => void) => (): void => { fn(); onClose() }

  const commands: Cmd[] = [
    { id: 'new-tab', glyph: '+', label: 'New tab', run: go(() => window.voyager.tabs.create({})) },
    { id: 'split', glyph: '◫', label: 'Split with the last tab', detail: 'Two pages side by side',
      run: go(async () => {
        const s = await window.voyager.layout.state()
        const others = s.tabs.filter((t) => t.id !== s.activeTabId)
        if (s.activeTabId && others.length) {
          window.voyager.layout.split([s.activeTabId, others[others.length - 1].id])
        }
      }) },
    { id: 'unsplit', glyph: '▭', label: 'Close split', run: go(() => window.voyager.layout.clearSplit()) },
    { id: 'organize', glyph: '⁝', label: 'Organize my tabs into groups', detail: 'Voyager decides the groups',
      run: go(() => void window.voyager.groups.autoOrganize()) },
    { id: 'tidy', glyph: '⌫', label: 'Tidy up idle tabs', run: () => window.voyager.openPanel('tidy') },
    { id: 'sidebar', glyph: '◫', label: 'Toggle the Voyager sidebar', run: go(() => window.voyager.layout.sidebar()) },
    { id: 'brief', glyph: '◔', label: 'Morning brief', run: () => window.voyager.openPanel('brief') },
    { id: 'deck', glyph: '▤', label: 'Make a deck or a report', run: () => window.voyager.openPanel('deck-composer') },
    { id: 'history', glyph: '🕘', label: 'History', run: () => window.voyager.openPanel('history') },
    { id: 'memory', glyph: '◈', label: 'What Voyager remembers', run: () => window.voyager.openPanel('memory') },
    { id: 'skills', glyph: '✧', label: 'Skills', run: () => window.voyager.openPanel('skills') },
    { id: 'connectors', glyph: '⚯', label: 'Connectors', run: () => window.voyager.openPanel('connectors') },
    { id: 'downloads', glyph: '⤓', label: 'Downloads', run: () => window.voyager.openPanel('downloads') },
    { id: 'settings', glyph: '⚙', label: 'Settings', run: () => window.voyager.openPanel('settings') },
    { id: 'bookmark', glyph: '☆', label: 'Bookmark this page',
      run: go(async () => {
        const s = await window.voyager.layout.state()
        const t = s.tabs.find((x) => x.id === s.activeTabId)
        if (t) void window.voyager.bookmarks.add(t.url, t.title)
      }) }
  ]

  const ql = q.trim().toLowerCase()
  const match = (s: string): boolean => !ql || s.toLowerCase().includes(ql)

  const rows: Cmd[] = [
    ...commands.filter((c) => match(c.label)),
    ...skills.filter((s) => match(s.slug) || match(s.name)).map((s) => ({
      id: `skill:${s.id}`, glyph: '✦', label: s.name, detail: `/${s.slug} — ${s.description}`,
      run: go(() => {
        window.voyager.layout.sidebar(true)
        void window.voyager.chat.send({ conversationId: null, text: '', attachments: [], skillSlug: s.slug })
      })
    })),
    ...tabs.filter((t) => match(t.title) || match(t.url)).slice(0, 6).map((t) => ({
      id: `tab:${t.id}`, glyph: '▢', label: t.title || t.url, detail: t.url,
      run: go(() => window.voyager.tabs.activate(t.id))
    })),
    ...history.map((h) => ({
      id: `h:${h.id}`, glyph: '🕘', label: h.title || h.url, detail: h.url,
      run: go(() => window.voyager.tabs.create({ url: h.url }))
    }))
  ]

  return (
    <div className="scrim top" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet">
        <div className="sheet-input">
          <span className="kind">Voyager</span>
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
