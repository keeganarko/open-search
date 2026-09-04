import { useCallback, useEffect, useState, type JSX } from 'react'
import type {
  ActionClass, ExtensionStatus, SavedLogin, Settings as S, SitePermission
} from '@shared/types'
import Panel from './Panel'
import SecurityStatus from './SecurityStatus'

const TABS = [
  'AI', 'Privacy', 'Security', 'Sites', 'Passwords', 'Extensions',
  'Appearance', 'Search', 'Brief', 'Approvals', 'Sync'
] as const
type Tab = typeof TABS[number]

/** Same vocabulary as the prompt sheet, phrased for a list rather than a question. */
const PERMISSION_LABEL: Record<string, string> = {
  media: 'Camera and microphone',
  geolocation: 'Location',
  notifications: 'Notifications',
  'display-capture': 'Screen sharing',
  'clipboard-read': 'Clipboard',
  fullscreen: 'Fullscreen',
  pointerLock: 'Mouse pointer capture',
  keyboardLock: 'Keyboard shortcut capture',
  midi: 'MIDI',
  midiSysex: 'MIDI system messages',
  'idle-detection': 'Idle detection',
  'window-management': 'Display layout',
  'speaker-selection': 'Speaker choice',
  'storage-access': 'Cookies in this site',
  'top-level-storage-access': 'Cookies across sites',
  hid: 'USB input devices',
  serial: 'Serial devices',
  usb: 'USB devices'
}

const ACTION_CLASSES: { id: ActionClass; label: string; hint: string }[] = [
  { id: 'read', label: 'Read', hint: 'Read a page, a tab, your history.' },
  { id: 'local_reversible', label: 'Local + reversible', hint: 'Group, close, or arrange tabs.' },
  { id: 'external_draft', label: 'Draft', hint: 'Prepare content for review.' },
  { id: 'external_write', label: 'External write', hint: 'Send, post, or create outside Voyager.' },
  { id: 'sensitive', label: 'Sensitive', hint: 'Money, deletion, credentials. Always asks.' }
]

interface Props {
  settings: S
  update: (patch: Record<string, unknown>) => Promise<void>
  onClose: () => void
  toast: (m: string, kind?: 'info' | 'error') => void
  initial?: Tab
}

export default function Settings({ settings, update, onClose, toast, initial }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>(initial ?? 'AI')
  const [key, setKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [exclude, setExclude] = useState(settings.privacy.excludedDomains.join('\n'))
  const [passphrase, setPassphrase] = useState('')
  const [perms, setPerms] = useState<SitePermission[] | null>(null)
  const [logins, setLogins] = useState<SavedLogin[] | null>(null)
  const [exts, setExts] = useState<ExtensionStatus[] | null>(null)
  const [shown, setShown] = useState<Record<string, string>>({})

  useEffect(() => setExclude(settings.privacy.excludedDomains.join('\n')),
    [settings.privacy.excludedDomains])

  // Each list is fetched when its tab is first opened rather than up front —
  // none of them is cheap enough to pay for on a settings panel that mostly
  // gets opened to change a checkbox.
  useEffect(() => {
    if (tab === 'Sites' && !perms) void window.voyager.permissions.list().then(setPerms)
    if (tab === 'Passwords' && !logins) void window.voyager.logins.list().then(setLogins)
    if (tab === 'Extensions' && !exts) void window.voyager.extensions.list().then(setExts)
  }, [tab, perms, logins, exts])

  const reveal = useCallback(async (id: string) => {
    if (shown[id]) return setShown((s) => { const n = { ...s }; delete n[id]; return n })
    const secret = await window.voyager.logins.reveal(id)
    if (secret) setShown((s) => ({ ...s, [id]: secret }))
    else toast('Password reveal needs successful Windows Hello or Touch ID authentication.', 'error')
  }, [shown, toast])

  useEffect(() => {
    if (!Object.keys(shown).length) return
    const timer = setTimeout(() => setShown({}), 30_000)
    return () => clearTimeout(timer)
  }, [shown])
  useEffect(() => { setShown({}) }, [tab])

  const ai = settings.ai
  const p = settings.privacy

  return (
    <Panel title="Settings" onClose={onClose}>
      <div className="settings-nav" style={{ margin: '-18px -20px 18px' }}>
        {TABS.map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Security' && <SecurityStatus />}
      {tab === 'AI' && (
        <>
          <div className="field">
            <label>Anthropic API key</label>
            <div className="desc">
              Stored with your operating system&apos;s protected credential storage, never in the
              settings file and never in a sync bundle.
              {ai.apiKeySet ? ' A key is set.' : ' No key set yet.'}
            </div>
            <div className="row">
              <input type="password" value={key} placeholder="sk-ant-…"
                onChange={(e) => setKey(e.target.value)} />
              <button className="btn primary" disabled={!key || testing}
                onClick={async () => {
                  setTesting(true)
                  const res = await window.voyager.settings.testKey(key)
                  setTesting(false)
                  if (!res.ok) return toast(res.error ?? 'Key rejected.', 'error')
                  try {
                    await update({ ai: { apiKey: key } })
                    setKey('')
                    toast('Key saved.')
                  } catch (err) {
                    toast(err instanceof Error ? err.message : String(err), 'error')
                  }
                }}>{testing ? 'Testing…' : 'Test & save'}</button>
              {ai.apiKeySet && (
                <button className="btn danger" onClick={() => update({ ai: { apiKey: null } })}>
                  Remove
                </button>
              )}
            </div>
          </div>

          <div className="field">
            <label>Model</label>
            <select value={ai.model} onChange={(e) => update({ ai: { model: e.target.value } })}>
              <option value="claude-opus-5">Claude Opus 5 — most capable</option>
              <option value="claude-sonnet-5">Claude Sonnet 5 — faster</option>
              <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5 — fastest</option>
            </select>
          </div>

          <div className="field">
            <label>Effort</label>
            <div className="desc">How hard Voyager thinks before answering. Higher costs more and takes longer.</div>
            <select value={ai.effort}
              onChange={(e) => update({ ai: { effort: e.target.value as S['ai']['effort'] } })}>
              {['low', 'medium', 'high', 'xhigh', 'max'].map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>

          <label className="check">
            <input type="checkbox" checked={ai.showThinking}
              onChange={(e) => update({ ai: { showThinking: e.target.checked } })} />
            Show Voyager's thinking
          </label>
          <label className="check">
            <input type="checkbox" checked={ai.contextConsent}
              onChange={(e) => update({ ai: { contextConsent: e.target.checked } })} />
            Allow browser context to be sent to Anthropic without asking for each AI task
          </label>
        </>
      )}

      {tab === 'Privacy' && (
        <>
          <label className="check">
            <input type="checkbox" checked={p.paused}
              onChange={(e) => update({ privacy: { paused: e.target.checked } })} />
            <strong>Pause Voyager</strong> — stop recording history and reading pages entirely
          </label>
          <label className="check">
            <input type="checkbox" checked={p.blockAds}
              onChange={(e) => update({ privacy: { blockAds: e.target.checked } })} />
            Block ads
          </label>
          <label className="check">
            <input type="checkbox" checked={p.blockTrackers}
              onChange={(e) => update({ privacy: { blockTrackers: e.target.checked } })} />
            Block trackers
          </label>
          <label className="check">
            <input type="checkbox" checked={p.spellcheckEnabled}
              onChange={(e) => update({ privacy: { spellcheckEnabled: e.target.checked } })} />
            Spell check
          </label>
          <div className="desc">On Windows and Linux, enabling spell check can download dictionaries from Google’s CDN.
            The built-in checker processes typed text locally. macOS uses the system spell checker.
            Restart Voyager after enabling it for existing tabs and the sidebar.</div>
          <label className="check">
            <input type="checkbox" checked={p.sendDoNotTrack}
              onChange={(e) => update({ privacy: { sendDoNotTrack: e.target.checked } })} />
            Send Do Not Track and Global Privacy Control
          </label>
          <label className="check">
            <input type="checkbox" checked={p.memoryEnabled}
              onChange={(e) => update({ privacy: { memoryEnabled: e.target.checked } })} />
            Let Voyager remember things about you
          </label>
          <label className="check">
            <input type="checkbox" checked={p.clearOnQuit}
              onChange={(e) => update({ privacy: { clearOnQuit: e.target.checked } })} />
            Clear cookies and cache on quit
          </label>

          <div className="field" style={{ marginTop: 18 }}>
            <label>Never read these sites</label>
            <div className="desc">
              One per line. A line matches if the hostname contains it. Pages here are never
              extracted, never stored in history, and never sent to the model.
            </div>
            <textarea rows={6} value={exclude} onChange={(e) => setExclude(e.target.value)}
              onBlur={() => update({
                privacy: {
                  excludedDomains: exclude.split('\n').map((s) => s.trim()).filter(Boolean)
                }
              })} />
          </div>

          <div className="field">
            <label>Keep history for</label>
            <div className="row">
              <input type="number" min={1} max={3650} style={{ width: 100 }}
                value={p.historyRetentionDays}
                onChange={(e) => update({
                  privacy: { historyRetentionDays: Math.max(1, Number(e.target.value) || 90) }
                })} />
              <span className="desc" style={{ margin: 0 }}>days</span>
            </div>
          </div>
        </>
      )}

      {tab === 'Appearance' && (
        <>
          <div className="field">
            <label>Theme</label>
            <select value={settings.appearance.theme}
              onChange={(e) => update({
                appearance: { theme: e.target.value as S['appearance']['theme'] }
              })}>
              <option value="system">Match system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div className="field">
            <label>Accent</label>
            <div className="row">
              {['#6366f1', '#e0568a', '#2f9e5f', '#c2761a', '#3b82f6', '#8b5cf6'].map((c) => (
                <button key={c} onClick={() => update({ appearance: { accent: c } })}
                  style={{
                    width: 26, height: 26, borderRadius: '50%', background: c,
                    outline: settings.appearance.accent === c ? '2px solid var(--ink)' : 'none',
                    outlineOffset: 2
                  }} />
              ))}
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={settings.appearance.compactChrome}
              onChange={(e) => update({ appearance: { compactChrome: e.target.checked } })} />
            Compact browser UI
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.appearance.startupStory}
              onChange={(e) => update({ appearance: { startupStory: e.target.checked } })} />
            Show the Voyager animation on launch
          </label>
          <label className="check">
            <input type="checkbox" checked={settings.appearance.startupSound}
              onChange={(e) => update({ appearance: { startupSound: e.target.checked } })} />
            Play the Voyager startup sound
          </label>
          {settings.appearance.startupSound && (
            <div className="field">
              <label>Opening volume</label>
              <input type="range" min={0} max={1} step={0.05}
                value={settings.appearance.startupVolume}
                onChange={(e) => update({
                  appearance: { startupVolume: Number(e.target.value) }
                })} />
              <div className="desc">
                Plays an original synthesized signature when the first window opens.
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'Search' && (
        <>
          <div className="field">
            <label>Search engine</label>
            <select value={settings.search.engine}
              onChange={(e) => update({ search: { engine: e.target.value as S['search']['engine'] } })}>
              <option value="google">Google</option>
              <option value="duckduckgo">DuckDuckGo</option>
              <option value="brave">Brave</option>
              <option value="kagi">Kagi</option>
            </select>
          </div>
          <label className="check">
            <input type="checkbox" checked={settings.search.askFirst}
              onChange={(e) => update({ search: { askFirst: e.target.checked } })} />
            Send questions typed in the address bar to Voyager instead of the search engine
          </label>
        </>
      )}

      {tab === 'Brief' && (
        <>
          <label className="check">
            <input type="checkbox" checked={settings.brief.enabled}
              onChange={(e) => update({ brief: { enabled: e.target.checked } })} />
            Generate a morning brief (requires AI context consent)
          </label>
          <div className="field">
            <label>At</label>
            <input type="time" style={{ width: 120 }} value={settings.brief.at}
              onChange={(e) => update({ brief: { at: e.target.value } })} />
          </div>
          {([
            ['includeCalendar', 'Calendar — currently unavailable'],
            ['includeMail', 'Mail — currently unavailable'],
            ['includeTabs', 'What you left open'],
            ['includeReadingList', 'Pages you saved to read']
          ] as const).map(([k, label]) => (
            <label className="check" key={k}>
              <input type="checkbox" disabled={k === 'includeCalendar' || k === 'includeMail'}
                checked={k === 'includeCalendar' || k === 'includeMail' ? false : settings.brief[k]}
                onChange={(e) => update({ brief: { [k]: e.target.checked } })} />
              {label}
            </label>
          ))}
        </>
      )}

      {tab === 'Approvals' && (
        <>
          <div className="desc" style={{ marginBottom: 14, maxWidth: 620 }}>
            Anything not ticked stops and asks you first. Connector calls, opening URLs,
            inserting page text, saving assistant memory, and sensitive actions always ask,
            whatever is set here.
          </div>
          {ACTION_CLASSES.map((c) => (
            <label className="check" key={c.id}>
              <input
                type="checkbox"
                disabled={c.id === 'sensitive'}
                checked={c.id === 'sensitive' ? false : settings.approvals.auto.includes(c.id)}
                onChange={(e) => {
                  const auto = new Set(settings.approvals.auto)
                  e.target.checked ? auto.add(c.id) : auto.delete(c.id)
                  void update({ approvals: { auto: [...auto] } })
                }}
              />
              <span>
                <strong>{c.label}</strong> — <span className="desc" style={{ display: 'inline' }}>{c.hint}</span>
              </span>
            </label>
          ))}
        </>
      )}

      {tab === 'Sync' && (
        <>
          <div className="desc" style={{ marginBottom: 14, maxWidth: 620 }}>
            Voyager writes one encrypted file to a folder you choose — put that folder in
            iCloud or Dropbox and your other machines can read it. Memory, skills, bookmarks, and appearance settings travel. API keys, connector secrets, and security choices stay on this machine.
          </div>
          <div className="field">
            <label>Folder</label>
            <div className="row">
              <input type="text" readOnly value={settings.sync.folder ?? 'Not set'} />
              <button className="btn" onClick={async () => {
                const f = await window.voyager.sync.chooseFolder()
                if (f) await update({ sync: { folder: f } })
              }}>Choose…</button>
            </div>
          </div>
          <div className="field">
            <label>Passphrase</label>
            <div className="desc">At least 8 characters. Voyager cannot recover it — if you lose it, the bundle is gone.</div>
            <input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          </div>
          <div className="row">
            <button className="btn primary" disabled={!settings.sync.folder || passphrase.length < 8}
              onClick={async () => {
                try {
                  const r = await window.voyager.sync.export(settings.sync.folder!, passphrase)
                  toast(`Exported to ${r.path}`)
                } catch (e) { toast(String((e as Error).message), 'error') }
              }}>Export now</button>
            <button className="btn" disabled={passphrase.length < 8}
              onClick={async () => {
                try {
                  const r = await window.voyager.sync.import(passphrase)
                  if (!r) return
                  const counts = [
                    `${r.skills} skills`, `${r.memory} memories`, `${r.bookmarks} bookmarks`,
                    `${r.connectors} connectors`
                  ]
                  toast(`Imported ${counts.join(', ')}${r.settings ? ', and settings' : ''}.`)
                } catch (e) { toast(String((e as Error).message), 'error') }
              }}>Import…</button>
          </div>
          {settings.sync.lastExportAt && (
            <div className="desc" style={{ marginTop: 10 }}>
              Last export {new Date(settings.sync.lastExportAt).toLocaleString()}
            </div>
          )}
        </>
      )}

      {tab === 'Sites' && (
        <>
          <div className="desc" style={{ marginBottom: 16, maxWidth: 620 }}>
            Every answer you have given a site about its camera, location, notifications
            and the rest. Removing one means the site asks again next time — it does not
            block it.
          </div>
          {perms === null && <div className="empty">Loading…</div>}
          {perms?.length === 0 && <div className="empty">No site has asked for anything yet.</div>}
          {perms?.map((sp) => (
            <div className="list-row" key={`${sp.origin}:${sp.permission}`}>
              <div className="main">
                <div className="t">{sp.origin.replace(/^https?:\/\//, '')}</div>
                <div className="s">
                  {PERMISSION_LABEL[sp.permission] ?? sp.permission}
                  {' · '}{new Date(sp.decidedAt).toLocaleDateString()}
                </div>
              </div>
              <span className={`badge ${sp.allowed ? 'ok' : 'err'}`}>
                {sp.allowed ? 'allowed' : 'blocked'}
              </span>
              <button className="btn" onClick={async () => {
                setPerms(await window.voyager.permissions.revoke(sp.origin, sp.permission))
              }}>Forget</button>
            </div>
          ))}
          {!!perms?.length && (
            <button className="btn danger" style={{ marginTop: 14 }} onClick={async () => {
              setPerms(await window.voyager.permissions.clear())
              toast('Every site will be asked again.')
            }}>Forget all</button>
          )}
        </>
      )}

      {tab === 'Passwords' && (
        <>
          <div className="desc" style={{ marginBottom: 16, maxWidth: 620 }}>
            Encrypted with your operating system&apos;s protected credential storage before they
            reach Voyager&apos;s database, so the file on disk holds nothing readable. Voyager
            offers to save one when you sign in, and fills it only on the site it came from.
            Excluded sites are never offered.
          </div>
          {logins === null && <div className="empty">Loading…</div>}
          {logins?.length === 0 && <div className="empty">No saved passwords.</div>}
          {logins?.map((l) => (
            <div className="list-row" key={l.id}>
              <div className="main">
                <div className="t">{l.origin.replace(/^https?:\/\//, '')}</div>
                <div className="s">
                  {l.username}
                  {shown[l.id] && <> · <code>{shown[l.id]}</code></>}
                </div>
              </div>
              <button className="btn" onClick={() => void reveal(l.id)}>
                {shown[l.id] ? 'Hide' : 'Show'}
              </button>
              <button className="btn danger" onClick={async () => {
                setLogins(await window.voyager.logins.remove(l.id))
              }}>Delete</button>
            </div>
          ))}
        </>
      )}

      {tab === 'Extensions' && (
        <>
          <div className="desc" style={{ marginBottom: 16, maxWidth: 620 }}>
            Unpacked extensions. Voyager implements a useful subset of the
            extension APIs — content scripts, storage and declarativeNetRequest work;
            toolbar popups and blocking webRequest do not exist, so an extension built
            around those will load and then quietly do nothing. There is no Web Store
            here: point Voyager at a folder containing manifest.json.
          </div>
          <button className="btn primary" onClick={async () => {
            try { setExts(await window.voyager.extensions.add()) }
            catch (e) { toast(String((e as Error).message), 'error') }
          }}>Load an extension folder…</button>

          {exts?.length === 0 && (
            <div className="empty" style={{ marginTop: 14 }}>Nothing loaded.</div>
          )}
          {exts?.map((x) => (
            <div className="card" key={x.path} style={{ marginTop: 12 }}>
              <div className="row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="t">{x.name} <span className="s">{x.version}</span></div>
                  <div className="s" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {x.error ?? x.path}
                  </div>
                </div>
                <span className={`badge ${x.loaded ? 'ok' : x.enabled ? 'warn' : ''}`}>
                  {x.loaded ? 'loaded' : x.enabled ? 'not loaded' : 'off'}
                </span>
                <span className="badge">MV{x.manifestVersion}</span>
                <button className="btn" onClick={async () => {
                  setExts(await window.voyager.extensions.toggle(x.path, !x.enabled))
                  toast('Restart Voyager for that to take full effect.')
                }}>{x.enabled ? 'Disable' : 'Enable'}</button>
                <button className="btn danger" onClick={async () => {
                  setExts(await window.voyager.extensions.remove(x.path))
                }}>Remove</button>
              </div>
            </div>
          ))}
        </>
      )}
    </Panel>
  )
}
