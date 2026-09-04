import { useEffect, useState, type JSX } from 'react'
import type { FullWindowState, TabState } from '@shared/types'

interface Props {
  state: FullWindowState
  active: TabState | undefined
  onOmnibox: () => void
  onPanel: (p: string | null) => void
  panel: string | null
}

function splitUrl(url: string): { lock: string; host: string; rest: string } {
  try {
    const u = new URL(url)
    const lock = u.protocol === 'https:' ? '🔒' : u.protocol === 'http:' ? '⚠' : ''
    return { lock, host: u.hostname.replace(/^www\./, ''), rest: u.pathname === '/' ? '' : u.pathname + u.search }
  } catch { return { lock: '', host: url, rest: '' } }
}

export default function Toolbar({ state, active, onOmnibox, onPanel, panel }: Props): JSX.Element {
  const [excluded, setExcluded] = useState(false)
  const url = active?.url ?? ''
  const parts = splitUrl(url)

  useEffect(() => {
    // Hostless URLs (a blank new tab, a local file) are excluded by definition,
    // and badging every one of them would make the shield meaningless.
    if (!/^https?:/i.test(url)) return setExcluded(false)
    void window.kia.settings.isExcluded(url).then(setExcluded)
  }, [url])

  const profile = state.profile

  return (
    <div className="toolbar">
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

      <div className="omnibox" onClick={onOmnibox} title="Search, type a URL, or ask Open Search (⌘L)">
        {parts.lock && <span className="lock">{parts.lock}</span>}
        <span className="url">
          {url
            ? <><span className="host">{parts.host}</span><span className="rest">{parts.rest}</span></>
            : <span className="rest">Search, type a URL, or ask Open Search…</span>}
        </span>
        {excluded && <span className="shield" title="Excluded — Open Search never reads this site">no-read</span>}
      </div>

      <button className="iconbtn" title="Bookmark this page (⌘D)" disabled={!active}
        onClick={() => active && window.kia.bookmarks.add(active.url, active.title)}>☆</button>
      <button className={`iconbtn${panel === 'history' ? ' on' : ''}`} title="History (⌘Y)"
        onClick={() => onPanel(panel === 'history' ? null : 'history')}>🕘</button>
      <button className={`iconbtn${panel === 'brief' ? ' on' : ''}`} title="Morning brief (⌘⇧B)"
        onClick={() => onPanel(panel === 'brief' ? null : 'brief')}>◔</button>
      <button
        className="iconbtn"
        title={`Profile: ${profile.name} — click to switch`}
        onClick={() => {
          const others = state.profiles.filter((p) => p.id !== profile.id)
          if (!others.length) return onPanel('settings')
          const idx = state.profiles.findIndex((p) => p.id === profile.id)
          void window.kia.profiles.switch(state.profiles[(idx + 1) % state.profiles.length].id)
        }}
      >
        <span style={{
          width: 15, height: 15, borderRadius: '50%', background: profile.color,
          display: 'inline-block'
        }} />
      </button>
      <button className={`iconbtn${state.sidebarOpen ? ' on' : ''}`} title="Toggle Open Search (⌘⇧K)"
        onClick={() => window.kia.layout.sidebar(!state.sidebarOpen)}>◫</button>
    </div>
  )
}
