import { useEffect, useState, type DragEvent, type JSX } from 'react'
import type { FullWindowState, TabState, TabGroup } from '@shared/types'

interface Props {
  state: FullWindowState
  active: TabState | undefined
  crashed: Set<string>
  panel: string | null
  onPanel: (p: string | null) => void
  onOmnibox: () => void
}

function splitUrl(url: string): { lock: string; host: string; rest: string } {
  try {
    const u = new URL(url)
    const lock = u.protocol === 'https:' ? '🔒' : u.protocol === 'http:' ? '⚠' : ''
    return {
      lock,
      host: u.hostname.replace(/^www\./, ''),
      rest: u.pathname === '/' ? '' : u.pathname + u.search
    }
  } catch { return { lock: '', host: url, rest: '' } }
}

/**
 * The left rail, Dia-shaped: pinned sites as favicon tiles across the top, the
 * omnibox and its nav under them, then the tabs running down the side, then the
 * new-tab row, then the panel buttons along the bottom.
 *
 * This owns every piece of chrome that used to be the horizontal tab strip and
 * the horizontal toolbar. Keeping them in one component is deliberate: the rail
 * is one column and the pieces have to agree on its width and its drag regions.
 */
export default function Rail({
  state, active, crashed, panel, onPanel, onOmnibox
}: Props): JSX.Element {
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropOn, setDropOn] = useState<{ id: string; after: boolean } | null>(null)
  const [excluded, setExcluded] = useState(false)

  const url = active?.url ?? ''
  const parts = splitUrl(url)

  useEffect(() => {
    // Hostless URLs (a blank new tab, a local file) are excluded by definition,
    // and badging every one of them would make the shield meaningless.
    if (!/^https?:/i.test(url)) return setExcluded(false)
    void window.kia.settings.isExcluded(url).then(setExcluded)
  }, [url])

  const ordered = [...state.tabs].sort((a, b) => a.index - b.index)
  const pinned = ordered.filter((t) => t.pinned)

  // Unpinned tabs keep their group runs; pinned ones are tiles instead and are
  // deliberately not repeated in the list below.
  const byGroup = new Map<string | null, TabState[]>()
  for (const t of ordered) {
    if (t.pinned) continue
    if (!byGroup.has(t.groupId)) byGroup.set(t.groupId, [])
    byGroup.get(t.groupId)!.push(t)
  }

  const onDrop = (e: DragEvent, target: TabState, after: boolean): void => {
    e.preventDefault()
    setDropOn(null)
    if (!dragId || dragId === target.id) return
    const order = ordered.map((t) => t.id)
    const from = order.indexOf(dragId)
    if (from < 0) return
    order.splice(from, 1)
    let to = order.indexOf(target.id)
    if (to < 0) return
    if (after) to += 1
    order.splice(to, 0, dragId)
    window.kia.tabs.reorder(order)
    // Dropping into another group's run adopts that group.
    if (target.groupId !== ordered.find((t) => t.id === dragId)?.groupId) {
      window.kia.groups.assign([dragId], target.groupId)
    }
    setDragId(null)
  }

  /** Vertical list, so the drop line is above or below the row, not left/right. */
  const below = (e: DragEvent): boolean => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientY > r.top + r.height / 2
  }

  const renderTab = (t: TabState): JSX.Element => {
    const isActive = t.id === state.activeTabId
    const inSplit = state.split?.tabIds.includes(t.id) ?? false
    const cls = [
      'vtab',
      isActive || inSplit ? 'active' : '',
      dragId === t.id ? 'dragging' : '',
      dropOn?.id === t.id ? (dropOn.after ? 'drop-after' : 'drop-before') : ''
    ].filter(Boolean).join(' ')

    return (
      <div
        key={t.id}
        className={cls}
        title={`${t.title}\n${t.url}\n\nRight-click to pin`}
        draggable
        onDragStart={() => setDragId(t.id)}
        onDragEnd={() => { setDragId(null); setDropOn(null) }}
        onDragOver={(e) => { e.preventDefault(); setDropOn({ id: t.id, after: below(e) }) }}
        onDragLeave={() => setDropOn((d) => (d?.id === t.id ? null : d))}
        onDrop={(e) => onDrop(e, t, below(e))}
        onClick={() => window.kia.tabs.activate(t.id)}
        onAuxClick={(e) => { if (e.button === 1) window.kia.tabs.close(t.id) }}
        onContextMenu={(e) => { e.preventDefault(); window.kia.tabs.pin(t.id, true) }}
      >
        {t.loading
          ? <span className="spinner" />
          : t.favicon
            ? <img className="favicon" src={t.favicon} alt="" onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
              }} />
            : <span className="favicon" style={{ background: 'var(--bg-sunken)' }} />}
        <span className="label">
          {crashed.has(t.id) ? '⚠︎ ' : ''}
          {t.audible && !t.muted ? '♫ ' : ''}
          {t.muted ? '🔇 ' : ''}
          {t.title || 'New tab'}
        </span>
        <button
          className="x"
          title="Close tab"
          onClick={(e) => { e.stopPropagation(); window.kia.tabs.close(t.id) }}
        >×</button>
      </div>
    )
  }

  const groupOf = (id: string | null): TabGroup | undefined =>
    state.groups.find((g) => g.id === id)

  return (
    <div className="rail" style={{ width: state.railWidth }}>
      {/* macOS insets its traffic lights here; every platform drags by it. */}
      <div className="rail-grab" />

      {pinned.length > 0 && (
        <div className="pinned">
          {pinned.map((t) => (
            <button
              key={t.id}
              className={`pintile${t.id === state.activeTabId ? ' active' : ''}`}
              title={`${t.title || t.url}\n\nRight-click to unpin`}
              onClick={() => window.kia.tabs.activate(t.id)}
              onAuxClick={(e) => { if (e.button === 1) window.kia.tabs.close(t.id) }}
              onContextMenu={(e) => { e.preventDefault(); window.kia.tabs.pin(t.id, false) }}
            >
              {t.favicon
                ? <img src={t.favicon} alt="" onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
                  }} />
                : <span className="letter">{splitUrl(t.url).host.slice(0, 1).toUpperCase() || '·'}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="rail-nav">
        <button className="iconbtn" title="Back (⌘[)" disabled={!active?.canGoBack}
          onClick={() => active && window.kia.tabs.back(active.id)}>‹</button>
        <button className="iconbtn" title="Forward (⌘])" disabled={!active?.canGoForward}
          onClick={() => active && window.kia.tabs.forward(active.id)}>›</button>
        <button className="iconbtn" title={active?.loading ? 'Stop (Esc)' : 'Reload (⌘R)'}
          disabled={!active}
          onClick={() => {
            if (!active) return
            active.loading ? window.kia.tabs.stop(active.id) : window.kia.tabs.reload(active.id)
          }}>{active?.loading ? '×' : '⟳'}</button>
        <button className="iconbtn" title="Bookmark this page (⌘D)" disabled={!active}
          onClick={() => active && window.kia.bookmarks.add(active.url, active.title)}>☆</button>
      </div>

      <div className="omnibox" onClick={onOmnibox}
        title="Search, type a URL, or ask Open Search (⌘L)">
        {parts.lock && <span className="lock">{parts.lock}</span>}
        <span className="url">
          {url
            ? <><span className="host">{parts.host}</span><span className="rest">{parts.rest}</span></>
            : <span className="rest">Search, type a URL, or ask…</span>}
        </span>
        {excluded && <span className="shield" title="Excluded — Open Search never reads this site">no-read</span>}
      </div>

      <div className="rail-tabs">
        {[...byGroup.entries()].map(([key, tabs]) => {
          const group = groupOf(key)
          return (
            <div className="grouprun" key={String(key)}>
              {group && (
                <button
                  className="group-chip"
                  style={{ background: `${group.color}22`, color: group.color }}
                  title={group.meeting
                    ? `${group.title} — ${group.meeting.eventTitle}`
                    : `${group.title} — click to collapse`}
                  onClick={() => window.kia.groups.update(group.id, { collapsed: !group.collapsed })}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    window.kia.groups.remove(group.id, false)
                  }}
                >
                  <span className="dot" style={{ background: group.color }} />
                  <span className="gname">{group.title}</span>
                  {group.collapsed ? <span className="count">{tabs.length}</span> : null}
                </button>
              )}
              {!group?.collapsed && tabs.map(renderTab)}
            </div>
          )
        })}
      </div>

      {/* Below the scroller, not inside it, so a long tab list never pushes the
          + out of reach — the whole reason it moved off the top-right. */}
      <button className="newtab" title="New tab (⌘T)" onClick={() => window.kia.tabs.create({})}>
        <span className="plus">+</span> New tab
      </button>

      <div className="rail-actions">
        <button className={`iconbtn${panel === 'history' ? ' on' : ''}`} title="History (⌘Y)"
          onClick={() => onPanel(panel === 'history' ? null : 'history')}>🕘</button>
        <button className={`iconbtn${panel === 'bookmarks' ? ' on' : ''}`} title="Bookmarks (⌘⇧O)"
          onClick={() => onPanel(panel === 'bookmarks' ? null : 'bookmarks')}>☰</button>
        <button className={`iconbtn${panel === 'brief' ? ' on' : ''}`} title="Morning brief (⌘⇧B)"
          onClick={() => onPanel(panel === 'brief' ? null : 'brief')}>◔</button>
        <span className="grow" />
        <button
          className="iconbtn"
          title={`Profile: ${state.profile.name} — click to switch`}
          onClick={() => {
            const others = state.profiles.filter((p) => p.id !== state.profile.id)
            if (!others.length) return onPanel('settings')
            const idx = state.profiles.findIndex((p) => p.id === state.profile.id)
            void window.kia.profiles.switch(state.profiles[(idx + 1) % state.profiles.length].id)
          }}
        >
          <span className="profiledot" style={{ background: state.profile.color }} />
        </button>
        <button className={`iconbtn${state.sidebarOpen ? ' on' : ''}`} title="Toggle Open Search (⌘⇧K)"
          onClick={() => window.kia.layout.sidebar(!state.sidebarOpen)}>◫</button>
      </div>
    </div>
  )
}
