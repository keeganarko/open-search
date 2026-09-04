import { useEffect, useState, type JSX } from 'react'
import type { HistoryEntry } from '@shared/types'
import Panel from './Panel'
import { prettyHost, relTime } from '../state'

export default function History({ onClose }: { onClose: () => void }): JSX.Element {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<HistoryEntry[]>([])

  useEffect(() => {
    const t = setTimeout(() => { void window.kia.history.search(q, 300).then(setRows) }, 120)
    return () => clearTimeout(t)
  }, [q])

  return (
    <Panel
      title="History"
      onClose={onClose}
      actions={
        <>
          <input type="text" placeholder="Search titles and page text…" style={{ width: 280 }}
            value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <button className="btn danger" onClick={async () => {
            await window.kia.history.clear()
            setRows(await window.kia.history.search(q, 300))
          }}>Clear all</button>
        </>
      }
    >
      <div className="desc" style={{ marginBottom: 12 }}>
        Full-text search across everything Open Search read. Excluded sites were never stored.
      </div>
      {rows.length === 0 && <div className="empty">{q ? 'Nothing matched.' : 'No history yet.'}</div>}
      {rows.map((h) => (
        <div className="list-row" key={h.id}>
          <button className="main" style={{ background: 'none', textAlign: 'left' }}
            onClick={() => window.kia.tabs.create({ url: h.url })}>
            <div className="t">{h.title || h.url}</div>
            <div className="s">{prettyHost(h.url)}{h.excerpt ? ` — ${h.excerpt.slice(0, 120)}` : ''}</div>
          </button>
          <span className="when">{relTime(h.visitedAt)}</span>
          <button className="iconbtn" title="Forget this visit"
            onClick={async () => {
              await window.kia.history.remove(h.id)
              setRows((r) => r.filter((x) => x.id !== h.id))
            }}>×</button>
          <button className="iconbtn" title={`Forget everything from ${prettyHost(h.url)}`}
            onClick={async () => {
              await window.kia.history.forgetDomain(prettyHost(h.url))
              setRows(await window.kia.history.search(q, 300))
            }}>⌫</button>
        </div>
      ))}
    </Panel>
  )
}
