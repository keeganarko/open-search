import { useEffect, useState, type JSX } from 'react'
import type { Bookmark } from '@shared/types'
import Panel from './Panel'
import { prettyHost, relTime } from '../state'

export default function Bookmarks({ onClose }: { onClose: () => void }): JSX.Element {
  const [rows, setRows] = useState<Bookmark[]>([])
  const [q, setQ] = useState('')

  useEffect(() => { void window.kia.bookmarks.list().then(setRows) }, [])

  const shown = rows.filter((b) =>
    !q || b.title.toLowerCase().includes(q.toLowerCase()) || b.url.toLowerCase().includes(q.toLowerCase()))

  return (
    <Panel
      title="Bookmarks"
      onClose={onClose}
      actions={<input type="text" placeholder="Filter…" style={{ width: 220 }}
        value={q} onChange={(e) => setQ(e.target.value)} autoFocus />}
    >
      {shown.length === 0 && <div className="empty">No bookmarks.</div>}
      {shown.map((b) => (
        <div className="list-row" key={b.id}>
          <button className="main" style={{ background: 'none', textAlign: 'left' }}
            onClick={() => window.kia.tabs.create({ url: b.url })}>
            <div className="t">{b.title || b.url}</div>
            <div className="s">{prettyHost(b.url)}{b.folder ? ` · ${b.folder}` : ''}</div>
          </button>
          <span className="when">{relTime(b.created_at)}</span>
          <button className="iconbtn" title="Remove"
            onClick={async () => setRows(await window.kia.bookmarks.remove(b.id))}>×</button>
        </div>
      ))}
    </Panel>
  )
}
