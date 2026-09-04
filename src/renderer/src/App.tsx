import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useAccent, useSettings, useTheme, useToasts, useWindowState } from './state'
import { playStartupSound } from './startupSound'
import Splash from './components/Splash'
import TabStrip from './components/TabStrip'
import Toolbar from './components/Toolbar'
import Sidebar from './components/Sidebar'
import SplitHandles from './components/SplitHandles'
import FindBar from './components/FindBar'
import Settings from './panels/Settings'
import Skills from './panels/Skills'
import Memory from './panels/Memory'
import Connectors from './panels/Connectors'
import History from './panels/History'
import Bookmarks from './panels/Bookmarks'
import Brief from './panels/Brief'
import Compose from './panels/Compose'
import Downloads from './panels/Downloads'
import Tidy from './panels/Tidy'
import Shortcuts from './panels/Shortcuts'

type PanelName =
  | 'settings' | 'privacy' | 'skills' | 'memory' | 'connectors' | 'history'
  | 'bookmarks' | 'brief' | 'deck-composer' | 'downloads' | 'tidy' | 'shortcuts'

export default function App(): JSX.Element {
  const state = useWindowState()
  const [settings, update] = useSettings()
  const [toasts, toast] = useToasts()
  const [panel, setPanel] = useState<PanelName | null>(null)
  const [finding, setFinding] = useState(false)
  const [crashed, setCrashed] = useState<Set<string>>(new Set())
  const closed = useRef<string[]>([])
  const [splash, setSplash] = useState(false)

  useTheme(settings?.appearance.theme)
  // Drives the tab strip's padding: macOS puts its window controls on the left,
  // Windows and Linux on the right.
  useEffect(() => { document.documentElement.dataset.platform = window.kia.platform }, [])
  useAccent(settings?.appearance.accent)

  // Main decides whether this window is the one that gets the opening, so a
  // second window opens in silence. A failure here is not worth a toast.
  useEffect(() => {
    void window.kia.opening()
      .then((o) => {
        if (!o) return
        if (o.story) setSplash(true)
        if (o.open && o.settle) void playStartupSound(o.volume, o.open, o.settle)
      })
      .catch((e) => console.warn('opening:', e))
  }, [])

  const endSplash = useCallback(() => {
    setSplash(false)
    window.kia.splashDone()
  }, [])

  // Menu → panel routing. One subscription per channel, all unsubscribed together.
  useEffect(() => {
    const names: PanelName[] = [
      'settings', 'privacy', 'skills', 'memory', 'connectors', 'history',
      'bookmarks', 'brief', 'deck-composer', 'shortcuts', 'tidy', 'downloads'
    ]
    const offs = names.map((n) => window.kia.onOpen(n as never, () => setPanel(n)))
    offs.push(window.kia.onOpen('find', () => setFinding(true)))
    offs.push(window.kia.onAutoOrganize(async () => {
      const r = await window.kia.groups.autoOrganize()
      toast(r.message, r.grouped ? 'info' : 'error')
    }))
    offs.push(window.kia.onReopenClosedTab(() => {
      const url = closed.current.pop()
      if (url) window.kia.tabs.create({ url })
      else toast('Nothing to reopen.')
    }))
    offs.push(window.kia.onTabCrashed(({ tabId }) => {
      setCrashed((c) => new Set(c).add(tabId))
      toast('That tab stopped responding. Reload it to try again.', 'error')
    }))
    offs.push(window.kia.onLoadFailed(({ description }) => {
      toast(`Could not load the page — ${description}`, 'error')
    }))
    offs.push(window.kia.onFocus('omnibox', () => openOmnibox()))
    offs.push(window.kia.brief.onReady(() => toast('Your morning brief is ready.')))
    return () => offs.forEach((f) => f())
  }, [toast])

  // Remember closed tabs so ⌘⇧T has something to reopen.
  const prevTabs = useRef<Map<string, string>>(new Map())
  useEffect(() => {
    if (!state) return
    const now = new Map(state.tabs.map((t) => [t.id, t.url]))
    for (const [id, url] of prevTabs.current) {
      if (!now.has(id) && url && !url.startsWith('about:')) closed.current.push(url)
    }
    closed.current = closed.current.slice(-25)
    prevTabs.current = now
    setCrashed((c) => new Set([...c].filter((id) => now.has(id))))
  }, [state])

  const openOmnibox = useCallback(() => {
    const el = document.querySelector('.omnibox')
    const r = el?.getBoundingClientRect()
    window.kia.overlay.open({
      kind: 'omnibox',
      anchor: r
        ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
        : { x: 100, y: 44, width: 600, height: 30 },
      query: ''
    })
  }, [])

  // Sidebar resize.
  const dragging = useRef(false)
  useEffect(() => {
    const move = (e: MouseEvent): void => {
      if (!dragging.current) return
      window.kia.layout.sidebarWidth(window.innerWidth - e.clientX)
    }
    const up = (): void => {
      if (dragging.current) { dragging.current = false; document.body.style.cursor = '' }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [])

  // The story has to survive the first paint: it starts before window state
  // has arrived, and that is the whole point of it.
  if (!state || !settings) {
    return (
      <div className="shell">
        <div className="emptystate"><h1>Open Search</h1></div>
        {splash && <Splash onDone={endSplash} />}
      </div>
    )
  }

  const active = state.tabs.find((t) => t.id === state.activeTabId)
  const close = (): void => setPanel(null)

  return (
    <div className="shell">
      <TabStrip state={state} crashed={crashed} />
      <Toolbar
        state={state}
        active={active}
        panel={panel}
        onPanel={(p) => setPanel(p as PanelName | null)}
        onOmnibox={openOmnibox}
      />

      <div className="body">
        <div className="content">
          {!active && (
            <div className="emptystate">
              <h1>Open Search</h1>
              <div className="hint">
                <kbd>⌘T</kbd> new tab · <kbd>⌘L</kbd> address bar · <kbd>⌘K</kbd> ask Open Search
              </div>
              <button className="btn primary" onClick={() => window.kia.tabs.create({})}>
                New tab
              </button>
            </div>
          )}
          {state.split && state.split.tabIds.length > 1 && <SplitHandles split={state.split} />}
          {finding && <FindBar onClose={() => setFinding(false)} />}

          {panel === 'settings' && <Settings settings={settings} update={update} onClose={close} toast={toast} />}
          {panel === 'privacy' && <Settings settings={settings} update={update} onClose={close} toast={toast} initial="Privacy" />}
          {panel === 'skills' && <Skills onClose={close} toast={toast} />}
          {panel === 'memory' && <Memory onClose={close} />}
          {panel === 'connectors' && <Connectors onClose={close} toast={toast} />}
          {panel === 'history' && <History onClose={close} />}
          {panel === 'bookmarks' && <Bookmarks onClose={close} />}
          {panel === 'brief' && <Brief onClose={close} toast={toast} />}
          {panel === 'deck-composer' && <Compose onClose={close} toast={toast} />}
          {panel === 'downloads' && <Downloads onClose={close} />}
          {panel === 'tidy' && <Tidy onClose={close} toast={toast} />}
          {panel === 'shortcuts' && <Shortcuts onClose={close} />}

          <div className="toasts">
            {toasts.map((t) => (
              <div className={`toast${t.kind === 'error' ? ' error' : ''}`} key={t.id}>{t.message}</div>
            ))}
          </div>
        </div>

        {state.sidebarOpen && (
          <>
            <div className="sidebar-handle"
              onMouseDown={() => { dragging.current = true; document.body.style.cursor = 'col-resize' }} />
            <Sidebar
              width={state.sidebarWidth}
              onPanel={(p) => setPanel(p as PanelName | null)}
              toast={toast}
            />
          </>
        )}
      </div>
      {splash && <Splash onDone={endSplash} />}
    </div>
  )
}
