import { useEffect, useState, type JSX } from 'react'
import type { ChromeProfile, ImportCounts, ImportPreview } from '@shared/browserImport'
import Panel from './Panel'

export function ImportBrowserContent({ profileName }: { profileName: string }): JSX.Element {
  const [profiles, setProfiles] = useState<ChromeProfile[]>([])
  const [selected, setSelected] = useState('')
  const [bookmarks, setBookmarks] = useState(true)
  const [history, setHistory] = useState(true)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [result, setResult] = useState<ImportCounts | null>(null)
  const profile = profiles.find((p) => p.id === selected)
  const chooseProfiles = (rows: ChromeProfile[] | null): void => {
    if (!rows) return
    setProfiles(rows); setSelected(rows[0]?.id ?? '')
  }
  useEffect(() => {
    let live = true
    const timer = setTimeout(() => { void window.voyager.browserImport.profiles().then((rows) => { if (live) chooseProfiles(rows) })
      .catch((e) => { if (live) setError(e.message) }).finally(() => { if (live) setBusy(false) })
    }, 0)
    return () => { live = false; clearTimeout(timer); window.voyager.browserImport.cancel() }
  }, [])
  const run = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true); setError('')
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : 'The import could not be completed.') }
    finally { setBusy(false) }
  }
  const reset = (): void => { window.voyager.browserImport.cancel(); setPreview(null); setResult(null); setError('') }
  const totals = (counts: ImportCounts): JSX.Element => <div className="import-totals">
    {(['bookmarks', 'history', 'passwords'] as const).map((key) => <div key={key}><strong>{counts[key].toLocaleString()}</strong><span>{key === 'history' ? 'History pages' : key === 'passwords' ? 'Passwords' : 'Bookmarks'}</span></div>)}
  </div>
  return <div className="import-content" aria-busy={busy}>
    <div className="import-heading"><span className="import-symbol" aria-hidden="true">↓</span><div><h2>Make yourself at home</h2><p>Bring your Chrome bookmarks, history, and saved passwords to Voyager.</p></div></div>
    <p className="import-destination">Import into <strong>{profileName}</strong> · Stored on this computer</p>
    {error && <div role="alert" className="import-error">{error}</div>}
    {result ? <div className="import-card" role="status"><h3>Import complete</h3>{totals(result)}<p>{result.duplicates} duplicates kept out · {result.skipped} records skipped</p><p>Your bookmarks and history are ready to search from the address bar. Ask Voyager to find a saved page when you want help.</p><button className="btn" onClick={reset}>Import more data</button></div>
      : preview ? <div className="import-card"><h3>Review your import</h3><p>{preview.source}</p>{totals(preview.counts)}
        <p>{preview.counts.duplicates} duplicates will be skipped · {preview.counts.skipped} unsupported or filtered records</p>
        {preview.warnings.map((warning) => <p className="import-note" key={warning}>{warning}</p>)}
        <p>Existing bookmarks and passwords stay as they are. This preview expires after 10 minutes.</p>
        <div className="row"><button className="btn" disabled={busy} onClick={reset}>Back</button><button className="btn primary" disabled={busy || !(preview.counts.bookmarks + preview.counts.history + preview.counts.passwords)}
          onClick={() => void run(async () => { setResult(await window.voyager.browserImport.commit(preview.id)); setPreview(null) })}>{busy ? 'Importing…' : 'Import data'}</button></div>
      </div> : <>
        <div className="import-card"><h3>Import from this computer</h3><p>If your data is saved to Google, first let it sync in Chrome on this computer.</p>
          {profiles.length ? <label className="field"><span>Chrome profile</span><select value={selected} disabled={busy} onChange={(e) => setSelected(e.target.value)}>{profiles.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.directory}</option>)}</select></label>
            : <p className="import-note">{busy ? 'Looking for Chrome profiles…' : 'No Chrome profiles found. Choose your Chrome profile folder, or use an exported file below.'}</p>}
          <label className="check"><input type="checkbox" aria-describedby="bookmark-import-help" checked={bookmarks && !!profile?.bookmarks} disabled={busy || !profile?.bookmarks} onChange={(e) => setBookmarks(e.target.checked)} />Bookmarks and folders</label>
          <p className="desc" id="bookmark-import-help">{!profile ? 'Select a Chrome profile to check for bookmarks.' : profile.bookmarks
            ? 'Includes readable bookmarks saved to your Google account on this computer.'
            : profile.bookmarksEncrypted ? 'Chrome has encrypted these bookmarks. Export them from Chrome’s bookmark manager, then use Choose HTML below.'
            : 'No readable bookmarks found in this profile. Choose another Chrome profile, or export bookmarks from Chrome and use Choose HTML below.'}</p>
          {profile?.bookmarks && profile.bookmarksEncrypted && <p className="import-note">Readable local copies may be older than Chrome’s encrypted bookmarks. Use an HTML export to include its latest saved pages.</p>}
          <label className="check"><input type="checkbox" checked={history && !!profile?.history} disabled={busy || !profile?.history} onChange={(e) => setHistory(e.target.checked)} />Browsing history</label>
          <p className="desc">History follows your retention and excluded-site settings. Quit Chrome if Voyager cannot read its data.</p>
          <div className="row"><button className="btn primary" disabled={busy || !profile || !(bookmarks && profile.bookmarks || history && profile.history)}
            onClick={() => void run(async () => { setPreview(await window.voyager.browserImport.preview({ profileId: selected, bookmarks: bookmarks && !!profile?.bookmarks, history: history && !!profile?.history })) })}>{busy ? 'Reading…' : 'Review import'}</button>
            <button className="btn" disabled={busy} onClick={() => void run(async () => chooseProfiles(await window.voyager.browserImport.profiles(true)))}>Choose folder…</button>
            <button className="btn" disabled={busy} onClick={() => void run(async () => chooseProfiles(await window.voyager.browserImport.profiles()))}>Refresh</button></div>
        </div>
        <div className="import-card"><h3>Import an exported file</h3>
          <div className="import-file-row"><div><strong>Bookmarks</strong><p>In Chrome’s bookmark manager, open the ⋮ menu and choose Export bookmarks.</p></div><button className="btn" disabled={busy} onClick={() => void run(async () => setPreview(await window.voyager.browserImport.file('bookmarks')))}>Choose HTML…</button></div>
          <div className="import-file-row"><div><strong>Saved passwords</strong><p>In Chrome, open Google Password Manager → Settings → Export passwords. The CSV contains readable passwords; delete it after importing.</p></div><button className="btn" disabled={busy} onClick={() => void run(async () => setPreview(await window.voyager.browserImport.file('passwords')))}>Choose CSV…</button></div>
        </div>
      </>}
    <div className="import-explainer"><h3>How Voyager uses your data</h3><p>Bookmarks and history help you find saved pages. The assistant can search them when you ask, with your existing AI consent and site exclusions. Importing does not send data to an AI service. Passwords stay in the encrypted vault.</p>
      <p>This is a one-time copy. Google account sync, website sign-ins, open tabs, extensions, payment details, addresses, and Google Collections are not imported. Sign in to your websites in Voyager to reconnect them.</p></div>
  </div>
}

export default function ImportBrowser({ onClose, profileName }: { onClose: () => void; profileName: string }): JSX.Element {
  return <Panel title="Import from Chrome" onClose={onClose}><ImportBrowserContent profileName={profileName} /></Panel>
}
