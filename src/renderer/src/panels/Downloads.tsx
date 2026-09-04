import { useEffect, useState, type JSX } from 'react'
import type { DownloadEntry } from '@shared/types'
import Panel from './Panel'
import { bytes, relTime } from '../state'

export default function Downloads({ onClose }: { onClose: () => void }): JSX.Element {
  const [rows, setRows] = useState<DownloadEntry[]>([])
  useEffect(() => {
    void window.kia.downloads.list().then(setRows)
    return window.kia.downloads.onChanged(setRows)
  }, [])

  return (
    <Panel
      title="Downloads"
      onClose={onClose}
      actions={<button className="btn" onClick={async () => setRows(await window.kia.downloads.clear())}>
        Clear list
      </button>}
    >
      {rows.length === 0 && <div className="empty">Nothing downloaded yet.</div>}
      {rows.map((d) => (
        <div className="list-row" key={d.id}>
          <div className="main">
            <div className="t">{d.filename}</div>
            <div className="s">
              {d.state === 'progressing'
                ? `${bytes(d.received)}${d.bytes ? ` of ${bytes(d.bytes)}` : ''}`
                : `${d.state} · ${bytes(d.received)}`}
            </div>
          </div>
          <span className="when">{relTime(d.startedAt)}</span>
          {d.state === 'completed' && (
            <button className="btn" onClick={() => window.kia.compose.reveal(d.path)}>Show</button>
          )}
        </div>
      ))}
    </Panel>
  )
}
