import { useEffect, useState, type FormEvent, type JSX } from 'react'
import type { Bookmark, TabState } from '@shared/types'
import { shortcutUrl } from '@shared/bookmarks'
import SiteIcon from './SiteIcon'
import { useEscape } from '../state'

export default function Favorites({ items, tabs, active, profileId }: {
  items: Bookmark[]; tabs: TabState[]; active?: TabState; profileId: string
}): JSX.Element {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [address, setAddress] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEscape(() => { setAdding(false); setEditing(false); setChoosing(false); setError('') }, adding || editing)
  useEffect(() => {
    if (!choosing) return
    let alive = true
    const refresh = (): void => {
      void window.voyager.bookmarks.list().then((rows) => {
        if (alive) setBookmarks(rows.filter((b) => b.profile_id === profileId && /^https?:\/\//i.test(b.url)))
      }).catch(() => { if (alive) setError('Could not load bookmarks.') })
    }
    const off = window.voyager.bookmarks.onChanged((id) => { if (id === profileId) refresh() })
    refresh()
    return () => { alive = false; off() }
  }, [choosing, profileId])

  const perform = async (action: () => Promise<unknown>): Promise<boolean> => {
    if (busy) return false
    setBusy(true); setError('')
    try { await action(); return true }
    catch (e) { setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Please try again.'); return false }
    finally { setBusy(false) }
  }
  const save = async (url: string, title: string): Promise<void> => {
    if (await perform(() => window.voyager.bookmarks.addShortcut(shortcutUrl(url), title, profileId))) {
      setAdding(false); setAddress(''); setName('')
    }
  }
  const submit = (e: FormEvent): void => { e.preventDefault(); void save(address, name) }
  const currentPage = active && /^https?:\/\//i.test(active.url) ? active : null

  return (
    <section className="favorites" aria-label="Favorite bookmarks">
      <div className="favorites-heading">
        <span>Favorites</span>
        <button type="button" onClick={() => { setEditing(!editing); setAdding(false); setChoosing(false); setError('') }}
          aria-label={editing ? 'Done editing favorites' : 'Edit favorites'} aria-pressed={editing}>
          {editing ? 'Done' : 'Edit'}
        </button>
      </div>
      <div className="favorites-grid">
        {items.map((bookmark) => (
          <div className="favorite-item" key={bookmark.id}>
            <button type="button" className={`favorite-tile${active?.url === bookmark.url ? ' active' : ''}`}
              title={`${bookmark.title}\n${bookmark.url}`} aria-label={`Open ${bookmark.title || bookmark.url}`}
              disabled={busy}
              onClick={() => { void perform(() => window.voyager.bookmarks.open(bookmark.id, profileId)) }}
              onContextMenu={(e) => { e.preventDefault(); setEditing(true); setAdding(false) }}>
              <SiteIcon url={bookmark.url} title={bookmark.title}
                favicon={tabs.find((tab) => tab.url === bookmark.url)?.favicon} />
            </button>
            {editing && <button type="button" className="favorite-remove" disabled={busy}
              title={`Remove ${bookmark.title} from favorites`} aria-label={`Remove ${bookmark.title} from favorites`}
              onClick={() => { void perform(() => window.voyager.bookmarks.setShortcut(bookmark.id, false, profileId)) }}>×</button>}
          </div>
        ))}
        <button type="button" className={`favorite-tile favorite-add${adding ? ' active' : ''}`}
          title="Add favorite" aria-label="Add favorite" aria-expanded={adding}
          onClick={() => { setAdding(!adding); setEditing(false); setChoosing(false); setError('') }}>+</button>
      </div>
      {adding && <form className="favorite-form" onSubmit={submit} aria-label="Add a favorite">
        <div className="favorite-form-title">Add a favorite</div>
        {currentPage && <button type="button" className="btn favorite-current" disabled={busy}
          onClick={() => { void save(currentPage.url, currentPage.title) }}>Add current page</button>}
        <label>Website address<input type="text" inputMode="url" autoComplete="off" autoCapitalize="off"
          spellCheck={false} placeholder="example.com" value={address} onChange={(e) => setAddress(e.target.value)}
          maxLength={8192} autoFocus required disabled={busy} /></label>
        <label>Name <span className="muted">(optional)</span><input type="text" placeholder="My favorite site"
          value={name} onChange={(e) => setName(e.target.value)} maxLength={200} disabled={busy} /></label>
        <div className="favorite-form-actions">
          <button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy || !address.trim()}>{busy ? 'Adding…' : 'Add'}</button>
        </div>
      </form>}
      {editing && <button type="button" className="favorite-manage" aria-expanded={choosing}
        onClick={() => setChoosing(!choosing)}>Choose from bookmarks</button>}
      {editing && choosing && <div className="favorite-picker" aria-label="Choose favorite bookmarks">
        {!bookmarks.length && <p>No website bookmarks yet.</p>}
        {bookmarks.map((b) => <button type="button" key={b.id} disabled={busy}
          aria-label={`${b.shortcut ? 'Remove' : 'Add'} ${b.title} ${b.shortcut ? 'from' : 'to'} favorites`}
          aria-pressed={b.shortcut}
          onClick={() => { void perform(() => window.voyager.bookmarks.setShortcut(b.id, !b.shortcut, profileId)) }}>
          <SiteIcon url={b.url} title={b.title} />
          <span className="favorite-picker-name">{b.title || b.url}</span><span aria-hidden="true">{b.shortcut ? '★' : '☆'}</span>
        </button>)}
      </div>}
      {error && <div className="favorite-error" role="alert">{error}</div>}
    </section>
  )
}
