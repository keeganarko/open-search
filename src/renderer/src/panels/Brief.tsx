import { useEffect, useState, type JSX } from 'react'
import type { Brief as B } from '@shared/types'
import Panel from './Panel'
import { Markdown } from '../markdown'

export default function Brief({ onClose, toast }: {
  onClose: () => void; toast: (m: string, k?: 'info' | 'error') => void
}): JSX.Element {
  const [brief, setBrief] = useState<B | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { void window.voyager.brief.get().then(setBrief) }, [])

  const generate = async (): Promise<void> => {
    setBusy(true)
    try { setBrief(await window.voyager.brief.generate()) }
    catch (e) { toast(String((e as Error).message), 'error') }
    setBusy(false)
  }

  return (
    <Panel
      title="Morning brief"
      onClose={onClose}
      narrow
      actions={<button className="btn primary" onClick={generate} disabled={busy}>
        {busy ? 'Writing…' : brief ? 'Regenerate' : 'Generate'}
      </button>}
    >
      {!brief && !busy && (
        <div className="empty">
          Nothing yet today. Voyager pulls from your calendar and mail connectors, the tabs you left
          open, and what you saved to read.
        </div>
      )}
      {brief?.sections.map((s, i) => (
        <div key={i} style={{ marginBottom: 26 }}>
          <div className="sectiontitle">{s.title}</div>
          {s.body && <div style={{ lineHeight: 1.55, userSelect: 'text' }}><Markdown text={s.body} /></div>}
          {s.items.map((item, j) => (
            <div className="list-row" key={j}>
              <div className="main">
                <div className="t" style={{ whiteSpace: 'normal' }}>{item.label}</div>
                {item.detail && <div className="s" style={{ whiteSpace: 'normal' }}>{item.detail}</div>}
              </div>
              {item.at && <span className="when">{item.at}</span>}
              {item.url && (
                <button className="btn" onClick={() => window.voyager.tabs.create({ url: item.url! })}>
                  Open
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
      {brief && (
        <div className="desc">Generated {new Date(brief.generatedAt).toLocaleString()}</div>
      )}
    </Panel>
  )
}
