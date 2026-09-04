import { useEffect, useState, type JSX } from 'react'
import type { SecurityStatus as Status } from '@shared/types'

export default function SecurityStatus(): JSX.Element {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = (): void => { void window.voyager.security.status().then(setStatus) }
  useEffect(() => { refresh(); const timer = setInterval(refresh, 30_000); return () => clearInterval(timer) }, [])
  const run = async (work: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try { await work(); refresh() } finally { setBusy(false) }
  }
  return <>
    <div className="sectiontitle">Browser updates</div>
    <p className="desc">{status?.updates ?? 'Checking status…'}</p>
    <button className="btn" disabled={busy} onClick={() => void run(window.voyager.security.update)}>Check for updates</button>
    <div className="sectiontitle">Malicious sites and downloads</div>
    <p className="desc">Known malware and phishing domains are blocked using a list checked on this device.
      List updates contact GitHub without sending your browsing addresses.</p>
    {status && <p className="desc">{status.threats.domains.toLocaleString()} domains loaded.
      {status.threats.updatedAt ? ` Updated ${new Date(status.threats.updatedAt).toLocaleString()}.` : ' No threat list loaded.'}
      {status.threats.stale ? ' Protection needs a fresh list.' : ''} {status.threats.error}</p>}
    <button className="btn" disabled={busy} onClick={() => void run(window.voyager.security.refreshThreats)}>Refresh protection</button>
    <p className="desc">Downloads require HTTPS. Executables and installers are blocked. Other files are checked
      before appearing in Downloads and receive Internet-origin markings on Windows and macOS.
      Archives and document content are not scanned for viruses.</p>
    <div className="sectiontitle">Local records and connectors</div>
    <p className="desc">Voyager&apos;s database is encrypted with a key protected by your operating system.
      Website caches, site storage and files you export need your device&apos;s disk encryption.
      Revealing a password requires Windows Hello or Touch ID; reveal is unavailable without supported authentication.</p>
    <p className="desc">Hosted connectors belong to one profile and each tool call needs approval.
      Local programs and private-network endpoints are disabled.</p>
  </>
}
