import { useEffect, useState, type JSX } from 'react'

export interface ScreenSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnail: string | null
  icon: string | null
}

const pretty = (origin: string): string => origin.replace(/^https?:\/\//, '')

/**
 * Chromium's own picker is not reachable from an Electron display-media
 * handler, so this is the picker. Cancelling has to send null rather than
 * simply closing: the page is holding a promise that only an answer settles.
 */
export default function ScreenPick(
  { origin, sources }: { origin: string; sources: ScreenSource[] }
): JSX.Element {
  const [tab, setTab] = useState<'screen' | 'window'>('screen')
  const [picked, setPicked] = useState<string | null>(null)

  const cancel = (): void => window.voyager.permissions.pickScreen(null)

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancel()
      if (e.key === 'Enter' && picked) window.voyager.permissions.pickScreen(picked)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [picked])

  const shown = sources.filter((s) => s.kind === tab)

  return (
    <div className="scrim top">
      <div className="sheet screenpick">
        <div className="perm-head">
          <span className="perm-icon">▢</span>
          <div>
            <div className="perm-title">
              Choose what to share with <strong>{pretty(origin)}</strong>.
            </div>
            <div className="perm-origin">It will see this until you stop sharing.</div>
          </div>
        </div>

        <div className="pick-tabs">
          <button className={tab === 'screen' ? 'on' : ''} onClick={() => setTab('screen')}>
            Entire screen
          </button>
          <button className={tab === 'window' ? 'on' : ''} onClick={() => setTab('window')}>
            A window
          </button>
        </div>

        <div className="pick-grid">
          {shown.length === 0 && <div className="empty">Nothing to share here.</div>}
          {shown.map((s) => (
            <button key={s.id}
              className={`pick-cell${picked === s.id ? ' sel' : ''}`}
              onClick={() => setPicked(s.id)}
              onDoubleClick={() => window.voyager.permissions.pickScreen(s.id)}>
              {s.thumbnail
                ? <img src={s.thumbnail} alt="" />
                : <div className="pick-blank" />}
              <div className="pick-name">
                {s.icon && <img className="pick-icon" src={s.icon} alt="" />}
                <span>{s.name}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="perm-actions">
          <button className="btn" onClick={cancel}>Cancel</button>
          <button className="btn primary" disabled={!picked}
            onClick={() => picked && window.voyager.permissions.pickScreen(picked)}>
            Share
          </button>
        </div>
      </div>
    </div>
  )
}
