import { useEffect, useRef, useState, type DragEvent, type JSX, type CSSProperties } from 'react'
import type { Bookmark, FullWindowState, TabState } from '@shared/types'
import { BROWSER_CHROME } from '@shared/chromeLayout'
import SiteIcon from './SiteIcon'
import VoyagerMark from './VoyagerMark'
import AgentLauncher from './AgentLauncher'

export default function BrowserChrome({ state, active, crashed, onPanel, onOmnibox, onAssistant, assistantOpen }: {
  state: FullWindowState; active?: TabState; crashed: Set<string>
  onPanel: (panel: string | null) => void; onOmnibox: () => void; onAssistant: () => void; assistantOpen: boolean
}): JSX.Element {
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropOn, setDropOn] = useState<{ id: string; after: boolean } | null>(null)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [excluded, setExcluded] = useState(false)
  const strip = useRef<HTMLDivElement>(null)
  const ordered = [...state.tabs].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.index - b.index)
  const mod = window.voyager.platform === 'darwin' ? '⌘' : 'Ctrl+'
  useEffect(() => {
    let live = true
    const refresh = (): void => { void window.voyager.bookmarks.list().then((rows) => {
      if (live) setBookmarks(rows.filter((b) => b.profile_id === state.profileId))
    }).catch(() => { if (live) setBookmarks([]) }) }
    refresh()
    const off = window.voyager.bookmarks.onChanged((id) => { if (id === state.profileId) refresh() })
    return () => { live = false; off() }
  }, [state.profileId])
  useEffect(() => {
    strip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [state.activeTabId, state.tabs.length])
  useEffect(() => {
    let live = true
    setExcluded(false)
    if (/^https?:/i.test(active?.url ?? '')) void window.voyager.settings.isExcluded(active!.url).then((value) => {
      if (live) setExcluded(value)
    })
    return () => { live = false }
  }, [active?.url])

  const after = (e: DragEvent): boolean => {
    const rect = e.currentTarget.getBoundingClientRect()
    return e.clientX > rect.x + rect.width / 2
  }
  const drop = (e: DragEvent, target: TabState): void => {
    e.preventDefault()
    if (dragId && dragId !== target.id) {
      const ids = ordered.map((t) => t.id).filter((id) => id !== dragId)
      ids.splice(ids.indexOf(target.id) + (after(e) ? 1 : 0), 0, dragId)
      window.voyager.tabs.reorder(ids)
      window.voyager.tabs.pin(dragId, target.pinned)
      window.voyager.groups.assign([dragId], target.groupId)
    }
    setDragId(null); setDropOn(null)
  }
  const renderTab = (t: TabState): JSX.Element => (
    <div key={t.id} role="tab" aria-selected={t.id === state.activeTabId}
      tabIndex={t.id === state.activeTabId ? 0 : -1}
      className={`browser-tab${t.id === state.activeTabId ? ' active' : ''}${t.pinned ? ' pinned-tab' : ''}${dragId === t.id ? ' dragging' : ''}${dropOn?.id === t.id ? dropOn.after ? ' drop-after' : ' drop-before' : ''}`}
      title={`${t.title || 'New tab'}${t.url ? `\n${t.url}` : ''}`} draggable
      onDragStart={() => setDragId(t.id)} onDragEnd={() => { setDragId(null); setDropOn(null) }}
      onDragOver={(e) => { e.preventDefault(); setDropOn({ id: t.id, after: after(e) }) }}
      onDragLeave={() => setDropOn(null)} onDrop={(e) => drop(e, t)}
      onClick={() => { onPanel(null); window.voyager.tabs.activate(t.id) }}
      onAuxClick={(e) => { if (e.button === 1) window.voyager.tabs.close(t.id) }}
      onContextMenu={(e) => { e.preventDefault(); window.voyager.tabMenu(t.id) }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPanel(null); window.voyager.tabs.activate(t.id) }
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault()
          const visible = ordered.filter((tab) => tab.pinned || !state.groups.find((g) => g.id === tab.groupId)?.collapsed || tab.id === state.activeTabId)
          const idx = (visible.findIndex((tab) => tab.id === t.id) + (e.key === 'ArrowRight' ? 1 : -1) + visible.length) % visible.length
          window.voyager.tabs.activate(visible[idx].id)
          strip.current?.querySelectorAll<HTMLElement>('[role="tab"]')[idx]?.focus()
        }
      }}>
      {t.loading ? <span className="tab-spinner" /> : <SiteIcon url={t.url} title={t.title || 'Voyager'} favicon={t.favicon} />}
      {!t.pinned && <span className="tab-label">{crashed.has(t.id) ? '⚠ ' : ''}{t.muted ? '◌ ' : t.audible ? '♫ ' : ''}{t.title || 'New tab'}</span>}
      {!t.pinned && <button className="tab-close" title="Close tab" aria-label={`Close ${t.title || 'tab'}`}
        onKeyDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); window.voyager.tabs.close(t.id) }}>×</button>}
    </div>
  )
  const renderedGroups = new Set<string>()
  const tabs: JSX.Element[] = []
  for (const t of ordered) {
    const group = !t.pinned && t.groupId ? state.groups.find((g) => g.id === t.groupId) : undefined
    if (!group) { tabs.push(renderTab(t)); continue }
    if (renderedGroups.has(group.id)) continue
    renderedGroups.add(group.id)
    tabs.push(<div className="tab-group" key={group.id} style={{ '--group-color': group.color } as CSSProperties}>
      <button className="tab-group-label" aria-expanded={!group.collapsed} title={`${group.title} — collapse or expand`}
        onClick={() => window.voyager.groups.update(group.id, { collapsed: !group.collapsed })}>{group.title}</button>
      {ordered.filter((tab) => !tab.pinned && tab.groupId === group.id && (!group.collapsed || tab.id === state.activeTabId)).map(renderTab)}
    </div>)
  }
  const bar = [...bookmarks].sort((a, b) => Number(b.shortcut) - Number(a.shortcut))
  const bookmarked = bookmarks.some((b) => b.url === active?.url)
  return <header className="browser-chrome" style={{ '--tab-height': `${BROWSER_CHROME.tabs}px`, '--toolbar-height': `${BROWSER_CHROME.toolbar}px`, '--bookmarks-height': `${BROWSER_CHROME.bookmarks}px` } as CSSProperties}>
    <div className="tab-strip">
      <button className="iconbtn tab-search" title="Search tabs and commands" aria-label="Search tabs and commands"
        onClick={() => window.voyager.overlay.open({ kind: 'palette' })}>⌄</button>
      <div className="horizontal-tabs" role="tablist" aria-label="Browser tabs" ref={strip}>{tabs}</div>
      <button className="iconbtn new-tab-button" title={`New tab (${mod}T)`} aria-label="New tab" onClick={() => { onPanel(null); window.voyager.tabs.create({}) }}>+</button>
      <div className="window-drag-space" />
    </div>
    <div className="browser-toolbar">
      <button className="iconbtn" aria-label="Back" title="Back" disabled={!active?.canGoBack} onClick={() => active && window.voyager.tabs.back(active.id)}>←</button>
      <button className="iconbtn" aria-label="Forward" title="Forward" disabled={!active?.canGoForward} onClick={() => active && window.voyager.tabs.forward(active.id)}>→</button>
      <button className="iconbtn" aria-label={active?.loading ? 'Stop loading' : 'Reload'} title={`Reload (${mod}R)`} disabled={!active}
        onClick={() => active && (active.loading ? window.voyager.tabs.stop(active.id) : window.voyager.tabs.reload(active.id))}>{active?.loading ? '×' : '⟳'}</button>
      <div className="address-field">
        <button className="omnibox" onClick={onOmnibox} title={`Search or enter address (${mod}L)`}>
          <span className="connection-indicator" title={active?.connectionSecure ? 'Secure connection' : active?.url ? 'Connection is not verified as secure' : 'Search'}>{active?.connectionSecure ? '▣' : active?.url ? 'ⓘ' : '⌕'}</span>
          <span className={`address-text${active?.url ? '' : ' placeholder'}`}>{active?.url || 'Search or type a URL'}</span>
          {excluded && <span className="shield">no-read</span>}
          {!excluded && !!active?.blockedRequests && <span className="shield" title="Blocked advertising and tracking requests">{active.blockedRequests} blocked</span>}
        </button>
        <button className="iconbtn bookmark-star" aria-label="Bookmark this page" title={`Bookmark this page (${mod}D)`} disabled={!/^https?:/i.test(active?.url ?? '')}
          onClick={() => active && void window.voyager.bookmarks.add(active.url, active.title)}>{bookmarked ? '★' : '☆'}</button>
      </div>
      <AgentLauncher profileId={state.profileId} />
      <button className={`voyager-button${assistantOpen ? ' on' : ''}`} title={`Ask Voyager (${mod}K)`} aria-label="Toggle Voyager assistant" aria-pressed={assistantOpen}
        onClick={onAssistant}><VoyagerMark /><span>Voyager</span></button>
      <button className="profile-button" style={{ background: state.profile.color }} title={`Profile: ${state.profile.name}`} aria-label={`Profile: ${state.profile.name}`} onClick={() => window.voyager.profileMenu()}>{state.profile.name.slice(0, 1).toUpperCase()}</button>
      <button className="iconbtn browser-menu-button" aria-label="Voyager menu" title="Customize Voyager" onClick={() => window.voyager.browserMenu()}>⋮</button>
    </div>
    {state.bookmarksBarOpen && <nav className="bookmarks-bar" aria-label="Bookmarks bar">
      <div className="bookmark-items">{bar.slice(0, 60).map((b) => <button className="bookmark-item" key={b.id} title={b.url}
        onClick={() => { onPanel(null); void window.voyager.bookmarks.open(b.id, state.profileId) }}><SiteIcon url={b.url} title={b.title} /><span>{b.title || b.url}</span></button>)}</div>
      <button className="bookmark-item" onClick={() => onPanel('import')} title="Bring bookmarks, history, and passwords from Chrome">Import from Chrome</button>
      <span className="bookmark-divider" />
      <button className="bookmark-item" onClick={() => onPanel('bookmarks')}>All bookmarks</button>
    </nav>}
  </header>
}
