import { useEffect, useState, type JSX } from 'react'
import type { TabState } from '@shared/types'
import Panel from './Panel'
import { prettyHost, relTime } from '../state'

/** Close what you stopped using, without hunting through the strip for it. */
export default function Tidy({ onClose, toast }: {
  onClose: () => void; toast: (m: string, k?: 'info' | 'error') => void
}): JSX.Element {
  const [days, setDays] = useState(3)
  const [rows, setRows] = useState<TabState[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())

  useEffect(() => {
    void window.kia.tabs.idle(days).then((r) => {
      setRows(r)
      setPicked(new Set(r.map((t) => t.id)))
    })
  }, [days])

  return (
    <Panel
      title="Tidy up"
      onClose={onClose}
      narrow
      actions={
        <>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 2, 3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>Untouched for {d} day{d > 1 ? 's' : ''}</option>
            ))}
          </select>
          <button className="btn danger" disabled={picked.size === 0}
            onClick={() => {
              picked.forEach((id) => window.kia.tabs.close(id))
              toast(`Closed ${picked.size} tab${picked.size > 1 ? 's' : ''}.`)
              onClose()
            }}>
            Close {picked.size || ''}
          </button>
        </>
      }
    >
      <div className="desc" style={{ marginBottom: 12 }}>
        Bookmark anything worth keeping first — closing is not undoable from here.
      </div>
      {rows.length === 0 && <div className="empty">Nothing has gone stale. Nice.</div>}
      {rows.map((t) => (
        <div className="list-row" key={t.id}>
          <input type="checkbox" checked={picked.has(t.id)}
            onChange={(e) => setPicked((p) => {
              const n = new Set(p)
              e.target.checked ? n.add(t.id) : n.delete(t.id)
              return n
            })} />
          <div className="main">
            <div className="t">{t.title || t.url}</div>
            <div className="s">{prettyHost(t.url)}</div>
          </div>
          <span className="when">{relTime(t.lastActiveAt)}</span>
          <button className="btn" onClick={() => {
            window.kia.bookmarks.add(t.url, t.title)
            toast('Bookmarked.')
          }}>Keep</button>
        </div>
      ))}
    </Panel>
  )
}
