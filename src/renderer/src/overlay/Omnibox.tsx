import { useEffect, useRef, useState, type JSX } from 'react'
import type { Bookmark, HistoryEntry, Settings } from '@shared/types'

interface Rect { x: number; y: number; width: number; height: number }

interface Row {
  kind: 'ask' | 'search' | 'url' | 'history' | 'tab' | 'bookmark'
  label: string
  detail?: string
  run: () => void
}

const QUESTION = /^(who|what|when|where|why|how|is|are|can|should|does|do|did|will|would|which)\b|\?\s*$/i
const LOOKS_URL = /^[a-z]+:\/\//i

function looksLikeUrl(s: string): boolean {
  if (LOOKS_URL.test(s)) return true
  if (/\s/.test(s.trim())) return false
  return /^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(s.trim()) || s.startsWith('localhost')
}

export default function Omnibox({ anchor, initial, settings, onClose }: {
  anchor: Rect; initial: string; settings: Settings | null; onClose: () => void
}): JSX.Element {
  const [q, setQ] = useState(initial)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [tabs, setTabs] = useState<{ id: string; title: string; url: string }[]>([])
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  useEffect(() => { void window.voyager.layout.state().then((s) => setTabs(s.tabs)) }, [])

  useEffect(() => {
    let live = true
    setHistory([]); setBookmarks([])
    if (!q.trim()) return
    const t = setTimeout(() => {
      void Promise.all([window.voyager.history.search(q, 6), window.voyager.bookmarks.search(q, 4)])
        .then(([h, b]) => { if (live) { setHistory(h); setBookmarks(b) } }).catch(() => {})
    }, 90)
    return () => { live = false; clearTimeout(t) }
  }, [q])

  const navigate = (url: string): void => {
    void window.voyager.layout.state().then((s) => {
      s.activeTabId ? window.voyager.tabs.navigate(s.activeTabId, url) : window.voyager.tabs.create({ url })
    })
    onClose()
  }

  const ask = (): void => {
    window.voyager.layout.sidebar(true)
    void window.voyager.chat.send({ conversationId: null, text: q, attachments: [] })
    onClose()
  }

  const rows: Row[] = []
  const trimmed = q.trim()

  if (trimmed) {
    const isQuestion = QUESTION.test(trimmed) && !looksLikeUrl(trimmed)
    const askRow: Row = {
      kind: 'ask', label: `Ask Voyager — “${trimmed}”`,
      detail: 'Answers here, using this page', run: ask
    }
    const goRow: Row = looksLikeUrl(trimmed)
      ? { kind: 'url', label: trimmed, detail: 'Go to this address', run: () => navigate(trimmed) }
      : { kind: 'search', label: trimmed, detail: `Search ${settings?.search.engine ?? 'the web'}`, run: () => navigate(trimmed) }

    // Questions go to the assistant; destinations go directly to navigation.
    if (isQuestion && settings?.search.askFirst !== false) rows.push(askRow, goRow)
    else rows.push(goRow, askRow)
  }

  for (const t of tabs.filter((t) =>
    trimmed && (t.title.toLowerCase().includes(trimmed.toLowerCase()) ||
      t.url.toLowerCase().includes(trimmed.toLowerCase()))).slice(0, 4)) {
    rows.push({
      kind: 'tab', label: t.title || t.url, detail: 'Switch to this tab',
      run: () => { window.voyager.tabs.activate(t.id); onClose() }
    })
  }

  for (const b of bookmarks) rows.push({ kind: 'bookmark', label: b.title || b.url,
    detail: `Bookmark · ${b.url}`, run: () => navigate(b.url) })

  for (const h of history.filter((h) => !bookmarks.some((b) => b.url === h.url)).slice(0, 6)) {
    rows.push({
      kind: 'history', label: h.title || h.url, detail: h.url,
      run: () => navigate(h.url)
    })
  }

  const GLYPH: Record<Row['kind'], string> = {
    ask: '✦', search: '⌕', url: '→', history: '◷', tab: '▢', bookmark: '☆'
  }

  const width = Math.min(Math.max(anchor.width, 520), window.innerWidth - 24)
  const left = Math.max(12, Math.min(anchor.x, window.innerWidth - width - 12))

  return (
    <>
      <div style={{ position: 'fixed', inset: 0 }} onClick={onClose} />
      <div className="anchored" style={{ left, top: anchor.y - 4, width }}>
        <div className="sheet-input">
          <span className="kind">{rows[sel]?.kind === 'ask' ? 'Ask' : 'Go'}</span>
          <input
            ref={input}
            value={q}
            placeholder="Search, type a URL, or ask Voyager…"
            onChange={(e) => { setQ(e.target.value); setSel(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => (s + 1) % Math.max(1, rows.length)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => (s - 1 + rows.length) % Math.max(1, rows.length)) }
              else if (e.key === 'Enter') {
                e.preventDefault()
                if (e.metaKey || e.ctrlKey) return ask()
                rows[sel]?.run()
              }
            }}
          />
        </div>
        {rows.length > 0 && (
          <div className="sheet-list">
            {rows.map((r, i) => (
              <button key={`${r.kind}-${i}`} className={`sheet-row${i === sel ? ' sel' : ''}`}
                onMouseEnter={() => setSel(i)} onClick={r.run}>
                <span className="glyph">{GLYPH[r.kind]}</span>
                <span className="main">
                  <span className="t">{r.label}</span>
                  {r.detail && <span className="s">{r.detail}</span>}
                </span>
                {i === sel && <span className="hint">↵</span>}
              </button>
            ))}
          </div>
        )}
        <div className="sheet-foot">
          <span>↵ open</span><span>{window.voyager.platform === 'darwin' ? '⌘↵' : 'Ctrl+↵'} ask Voyager</span><span>esc cancel</span>
        </div>
      </div>
    </>
  )
}
