import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { useAccent, useSettings, useTheme, useToasts, useWindowState } from './state'
import { playStartupSound } from './startupSound'
import Splash from './components/Splash'
import BrowserChrome from './components/BrowserChrome'
import ImportBrowser from './panels/ImportBrowser'
import Profiles from './panels/Profiles'
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
import Agents from './panels/Agents'

type PanelName =
  | 'settings' | 'privacy' | 'skills' | 'memory' | 'connectors' | 'history'
  | 'bookmarks' | 'brief' | 'deck-composer' | 'downloads' | 'tidy' | 'shortcuts' | 'import' | 'profiles'

export default function App(): JSX.Element {
  const state = useWindowState()
  const [settings, update] = useSettings()
  const [toasts, toast] = useToasts()
  const [panel, setPanel] = useState<PanelName | null>(null)
  const [finding, setFinding] = useState(false)
  const [crashed, setCrashed] = useState<Set<string>>(new Set())
  const [splash, setSplash] = useState(false)
  const [sidebarMode, setSidebarMode] = useState<'chat' | 'agents'>('chat')
  useEffect(() => window.voyager.agents.onOpen(() => setSidebarMode('agents')), [])
  useEffect(() => window.voyager.onFocus('composer', () => setSidebarMode('chat')), [])

  useTheme(settings?.appearance.theme)
  // Reserve the correct side of the tab strip for native window controls.
  useEffect(() => { document.documentElement.dataset.platform = window.voyager.platform }, [])
  useAccent(settings?.appearance.accent)

  // Main decides whether this window is the one that gets the opening, so a
  // second window opens in silence. A failure here is not worth a toast.
  useEffect(() => {
    void window.voyager.opening()
      .then((o) => {
        if (!o) return
        if (o.story) setSplash(true)
        if (o.sound) void playStartupSound(o.volume)
      })
      .catch((e) => console.warn('opening:', e))
  }, [])

  const endSplash = useCallback(() => {
    setSplash(false)
    window.voyager.splashDone()
  }, [])

  // Menu → panel routing. One subscription per channel, all unsubscribed together.
  useEffect(() => {
    const names: PanelName[] = [
      'settings', 'privacy', 'skills', 'memory', 'connectors', 'history',
      'bookmarks', 'brief', 'deck-composer', 'shortcuts', 'tidy', 'downloads', 'import', 'profiles'
    ]
    const offs = names.map((n) => window.voyager.onOpen(n as never, () => setPanel(n)))
    offs.push(window.voyager.onOpen('find', () => setFinding(true)))
    offs.push(window.voyager.onAutoOrganize(async () => {
      const r = await window.voyager.groups.autoOrganize()
      toast(r.message, r.grouped ? 'info' : 'error')
    }))
    offs.push(window.voyager.onTabCrashed(({ tabId }) => {
      setCrashed((c) => new Set(c).add(tabId))
      toast('That tab stopped responding. Reload it to try again.', 'error')
    }))
    offs.push(window.voyager.onLoadFailed(({ description }) => {
      toast(`Could not load the page — ${description}`, 'error')
    }))
    offs.push(window.voyager.onFocus('omnibox', () => (document.querySelector('.omnibox') as HTMLButtonElement | null)?.click()))
    offs.push(window.voyager.brief.onReady(() => toast('Your morning brief is ready.')))
    return () => offs.forEach((f) => f())
  }, [toast])

  useEffect(() => {
    window.voyager.layout.panel(panel !== null)
    return () => window.voyager.layout.panel(false)
  }, [panel])

  // Keep crash badges scoped to tabs that are still live.
  useEffect(() => {
    if (!state) return
    const now = new Map(state.tabs.map((t) => [t.id, t.url]))
    setCrashed((c) => new Set([...c].filter((id) => now.has(id))))
  }, [state])

  const openOmnibox = useCallback(() => {
    const el = document.querySelector('.omnibox')
    const r = el?.getBoundingClientRect()
    window.voyager.overlay.open({
      kind: 'omnibox',
      anchor: r
        ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
        : { x: 100, y: 44, width: 600, height: 30 },
      query: state?.tabs.find((t) => t.id === state.activeTabId)?.url ?? ''
    })
  }, [state])

  // Sidebar resize. One ref, because only one edge can be dragged at a
  // time and each reads the pointer from its own side of the window.
  const dragging = useRef<'sidebar' | null>(null)
  const grab = (edge: 'sidebar') => (): void => {
    dragging.current = edge
    document.body.style.cursor = 'col-resize'
  }
  useEffect(() => {
    const move = (e: MouseEvent): void => {
      if (dragging.current === 'sidebar') window.voyager.layout.sidebarWidth(window.innerWidth - e.clientX)
    }
    const up = (): void => {
      if (dragging.current) { dragging.current = null; document.body.style.cursor = '' }
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
        <div className="emptystate"><h1>Voyager</h1></div>
        {splash && <Splash onDone={endSplash} />}
      </div>
    )
  }

  const active = state.tabs.find((t) => t.id === state.activeTabId)
  const shownSettings = { ...settings, appearance: { ...settings.appearance, compactChrome: !state.bookmarksBarOpen } }
  const close = (): void => setPanel(null)

  const mac = window.voyager.platform === 'darwin'
  const mod = mac ? '⌘' : 'Ctrl+'

  return (
    <div className="shell">
      <BrowserChrome state={state} active={active} crashed={crashed}
        onPanel={(p) => setPanel(p as PanelName | null)} onOmnibox={openOmnibox}
        assistantOpen={state.sidebarOpen && sidebarMode === 'chat'}
        onAssistant={() => { setSidebarMode('chat'); window.voyager.layout.sidebar(!(state.sidebarOpen && sidebarMode === 'chat')) }} />
      <div className="body">
        <div className="content">
          {!active && (
            <div className="emptystate">
              <h1>Voyager</h1>
              <div className="hint">
                <kbd>{mod}T</kbd> new tab · <kbd>{mod}L</kbd> address bar · <kbd>{mod}K</kbd> ask Voyager
              </div>
              <button className="btn primary" onClick={() => window.voyager.tabs.create({})}>
                New tab
              </button>
            </div>
          )}
          {state.split && state.split.tabIds.length > 1 && <SplitHandles split={state.split} />}
          {finding && <FindBar onClose={() => setFinding(false)} />}

          {panel === 'profiles' && <Profiles profileId={state.profileId} onClose={close} />}
          {panel === 'import' && <ImportBrowser key={state.profileId} profileName={state.profile.name} onClose={close} />}
          {panel === 'settings' && <Settings settings={shownSettings} update={update} onClose={close} toast={toast} />}
          {panel === 'privacy' && <Settings settings={shownSettings} update={update} onClose={close} toast={toast} initial="Privacy" />}
          {panel === 'skills' && <Skills onClose={close} toast={toast} />}
          {panel === 'memory' && <Memory onClose={close} />}
          {panel === 'connectors' && <Connectors onClose={close} toast={toast} />}
          {panel === 'history' && <History onClose={close} />}
          {panel === 'bookmarks' && <Bookmarks key={state.profileId} profileId={state.profileId} onClose={close} />}
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
            <div className="sidebar-handle" onMouseDown={grab('sidebar')} />
            {sidebarMode === 'agents' && <Agents key={state.profileId} browser={state} onChat={() => setSidebarMode('chat')} />}
            <div style={{ display: sidebarMode === 'chat' ? 'contents' : 'none' }}><Sidebar
              profileId={state.profileId}
              width={state.sidebarWidth}
              onPanel={(p) => setPanel(p as PanelName | null)}
              toast={toast}
            /></div>
          </>
        )}
      </div>
      {splash && <Splash onDone={endSplash} />}
    </div>
  )
}
