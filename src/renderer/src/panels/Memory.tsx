import { useEffect, useState, type JSX } from 'react'
import type { MemoryItem, MemoryKind } from '@shared/types'
import Panel from './Panel'
import { relTime } from '../state'

const KINDS: MemoryKind[] = ['preference', 'fact', 'project', 'person', 'contact']

export default function Memory({ onClose }: { onClose: () => void }): JSX.Element {
  const [items, setItems] = useState<MemoryItem[]>([])
  const [draft, setDraft] = useState('')
  const [kind, setKind] = useState<MemoryKind>('fact')

  useEffect(() => { void window.voyager.memory.list().then(setItems) }, [])

  return (
    <Panel
      title="What Voyager remembers"
      onClose={onClose}
      actions={
        <button className="btn danger" onClick={async () => {
          if (items.length) setItems(await window.voyager.memory.clear())
        }}>Forget everything</button>
      }
    >
      <div className="desc" style={{ marginBottom: 14, maxWidth: 640 }}>
        Voyager writes these itself as you browse and chat, and reads them back as background —
        never as instructions. Delete anything that is wrong or that you would rather it did not know.
      </div>

      <div className="row" style={{ marginBottom: 18, maxWidth: 640 }}>
        <input type="text" style={{ flex: 1 }} placeholder="Add something Voyager should know…"
          value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Enter' && draft.trim()) {
              setItems(await window.voyager.memory.add(draft.trim(), kind))
              setDraft('')
            }
          }} />
        <select value={kind} onChange={(e) => setKind(e.target.value as MemoryKind)}>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>

      {items.length === 0 && <div className="empty">Nothing remembered yet.</div>}
      {items.map((m) => (
        <div className="list-row" key={m.id}>
          <span className="badge">{m.kind}</span>
          <div className="main">
            <div className="t" style={{ whiteSpace: 'normal' }}>{m.text}</div>
            <div className="s">
              {m.source} · {relTime(m.createdAt)}
              {m.useCount > 0 ? ` · used ${m.useCount}×` : ''}
              {m.expiresAt ? ` · re-check ${new Date(m.expiresAt).toLocaleDateString()}` : ''}
            </div>
          </div>
          <button className="iconbtn" title={m.pinned ? 'Unpin' : 'Pin'}
            onClick={async () => setItems(await window.voyager.memory.pin(m.id, !m.pinned))}>
            {m.pinned ? '★' : '☆'}
          </button>
          <button className="iconbtn" title="Forget"
            onClick={async () => setItems(await window.voyager.memory.remove(m.id))}>×</button>
        </div>
      ))}
    </Panel>
  )
}
