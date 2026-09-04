import { useState, type DragEvent, type JSX } from 'react'
import type { FullWindowState, TabState, TabGroup } from '@shared/types'

interface Props {
  state: FullWindowState
  crashed: Set<string>
}

/** Tabs, in group order, with drag-to-reorder and drag-onto-group. */
export default function TabStrip({ state, crashed }: Props): JSX.Element {
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropOn, setDropOn] = useState<{ id: string; after: boolean } | null>(null)

  const byGroup = new Map<string | null, TabState[]>()
  for (const t of [...state.tabs].sort((a, b) => a.index - b.index)) {
    const key = t.pinned ? '__pinned' : t.groupId
    if (!byGroup.has(key)) byGroup.set(key, [])
    byGroup.get(key)!.push(t)
  }

  const onDrop = (e: DragEvent, target: TabState, after: boolean): void => {
    e.preventDefault()
    setDropOn(null)
    if (!dragId || dragId === target.id) return
    const order = [...state.tabs].sort((a, b) => a.index - b.index).map((t) => t.id)
    const from = order.indexOf(dragId)
    if (from < 0) return
    order.splice(from, 1)
    let to = order.indexOf(target.id)
    if (to < 0) return
    if (after) to += 1
    order.splice(to, 0, dragId)
    window.kia.tabs.reorder(order)
    // Dropping into another group's run adopts that group.
    if (target.groupId !== state.tabs.find((t) => t.id === dragId)?.groupId) {
      window.kia.groups.assign([dragId], target.groupId)
    }
    setDragId(null)
  }

  const renderTab = (t: TabState): JSX.Element => {
    const active = t.id === state.activeTabId
    const inSplit = state.split?.tabIds.includes(t.id) ?? false
    const cls = [
      'tab',
      active || inSplit ? 'active' : '',
      t.pinned ? 'pinned' : '',
      dragId === t.id ? 'dragging' : '',
      dropOn?.id === t.id ? (dropOn.after ? 'drop-after' : 'drop-before') : ''
    ].filter(Boolean).join(' ')

    return (
      <div
        key={t.id}
        className={cls}
        title={`${t.title}\n${t.url}`}
        draggable
        onDragStart={() => setDragId(t.id)}
        onDragEnd={() => { setDragId(null); setDropOn(null) }}
        onDragOver={(e) => {
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          setDropOn({ id: t.id, after: e.clientX > r.left + r.width / 2 })
        }}
        onDragLeave={() => setDropOn((d) => (d?.id === t.id ? null : d))}
        onDrop={(e) => onDrop(e, t, e.clientX > e.currentTarget.getBoundingClientRect().left +
          e.currentTarget.getBoundingClientRect().width / 2)}
        onClick={() => window.kia.tabs.activate(t.id)}
        onAuxClick={(e) => { if (e.button === 1) window.kia.tabs.close(t.id) }}
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
        {!t.pinned && (
          <button
            className="x"
            title="Close tab"
            onClick={(e) => { e.stopPropagation(); window.kia.tabs.close(t.id) }}
          >×</button>
        )}
      </div>
    )
  }

  const groupOf = (id: string | null): TabGroup | undefined =>
    state.groups.find((g) => g.id === id)

  return (
    <div className="tabstrip">
      <div className="tabstrip-scroll">
        {[...byGroup.entries()].map(([key, tabs]) => {
          const group = key === '__pinned' ? undefined : groupOf(key as string | null)
          return (
            <div key={String(key)} style={{ display: 'flex', alignItems: 'flex-end', gap: 2 }}>
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
                  {group.title}
                  {group.collapsed ? ` (${tabs.length})` : ''}
                </button>
              )}
              {!group?.collapsed && tabs.map(renderTab)}
            </div>
          )
        })}
        <button
          className="newtab"
          title="New tab (Ctrl/Cmd+T)"
          onClick={() => window.kia.tabs.create({})}
        >+</button>
      </div>
      <div className="tabstrip-spacer" />
    </div>
  )
}
