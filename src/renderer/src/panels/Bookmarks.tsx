import { useEffect, useState, type JSX } from 'react'
import type { Bookmark } from '@shared/types'
import Panel from './Panel'
import { prettyHost, relTime } from '../state'
import SiteIcon from '../components/SiteIcon'

export default function Bookmarks({ onClose, profileId }: { onClose: () => void; profileId: string }): JSX.Element {
  const [rows, setRows] = useState<Bookmark[]>([])
  const [q, setQ] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      void window.voyager.bookmarks.list().then((rows) => { if (alive) setRows(rows.filter((b) => b.profile_id === profileId)) })
        .catch(() => { if (alive) setError('Could not load bookmarks.') })
    }
    const off = window.voyager.bookmarks.onChanged((id) => { if (id === profileId) refresh() })
    refresh()
    return () => { alive = false; off() }
  }, [profileId])

  const shown = rows.filter((b) =>
    !q || b.title.toLowerCase().includes(q.toLowerCase()) || b.url.toLowerCase().includes(q.toLowerCase()))

  return (
    <Panel
      title="Bookmarks"
      onClose={onClose}
      actions={<input type="text" placeholder="Filter…" style={{ width: 220 }}
        value={q} onChange={(e) => setQ(e.target.value)} autoFocus />}
    >
      <p className="desc">Star a bookmark to keep its icon in Favorites at the top left.</p>
      {error && <div role="alert" className="favorite-error">{error}</div>}
      {shown.length === 0 && <div className="empty">No bookmarks.</div>}
      {shown.map((b) => (
        <div className="list-row" key={b.id}>
          <SiteIcon url={b.url} title={b.title} />
          <button className="main" style={{ background: 'none', textAlign: 'left' }}
            onClick={() => window.voyager.tabs.create({ url: b.url })}>
            <div className="t">{b.title || b.url}</div>
            <div className="s">{prettyHost(b.url)}{b.folder ? ` · ${b.folder}` : ''}</div>
          </button>
          <span className="when">{relTime(b.created_at)}</span>
          <button className="iconbtn" title={b.shortcut ? 'Remove from favorites' : 'Add to favorites'}
            aria-label={`${b.shortcut ? 'Remove' : 'Add'} ${b.title} ${b.shortcut ? 'from' : 'to'} favorites`}
            aria-pressed={b.shortcut}
            onClick={() => {
              setError('')
              void window.voyager.bookmarks.setShortcut(b.id, !b.shortcut, profileId)
                .catch((e) => setError(e instanceof Error ? e.message : 'Could not update favorite.'))
            }}>{b.shortcut ? '★' : '☆'}</button>
          <button className="iconbtn" title="Remove"
            onClick={() => {
              void window.voyager.bookmarks.remove(b.id, profileId)
                .catch(() => setError('Could not remove bookmark.'))
            }}>×</button>
        </div>
      ))}
    </Panel>
  )
}
