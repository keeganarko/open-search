import { useEffect, useState, type JSX } from 'react'
import type { Profile } from '@shared/types'
import Panel from './Panel'

export default function Profiles({ profileId, onClose }: { profileId: string; onClose: () => void }): JSX.Element {
  const [rows, setRows] = useState<Profile[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { void window.voyager.profiles.list().then(setRows).catch(() => setError('Could not load profiles.')) }, [profileId])
  return <Panel title="Profiles" onClose={onClose} narrow>
    <p className="desc">Keep work and personal browsing separate. Switch to a profile before importing its Chrome data.</p>
    {error && <p role="alert" className="import-error">{error}</p>}
    {rows.map((p) => <div className="list-row" key={p.id}><span className="profile-button" style={{ background: p.color, display: 'grid', placeItems: 'center' }}>{p.name.slice(0, 1).toUpperCase()}</span>
      <div className="main"><div className="t">{p.name}</div></div>
      <button className="btn" disabled={p.id === profileId || busy} onClick={() => {
        setBusy(true)
        void window.voyager.profiles.switch(p.id).then(onClose).catch(() => setError('Could not switch profiles.')).finally(() => setBusy(false))
      }}>{p.id === profileId ? 'Current profile' : 'Switch'}</button></div>)}
    <form className="row" style={{ marginTop: 24 }} onSubmit={(e) => {
      e.preventDefault(); if (!name.trim() || busy) return
      setBusy(true); setError('')
      void window.voyager.profiles.create(name.trim(), '#6366f1', '').then((p) => {
        setRows((r) => [...r, p]); setName('')
      }).catch(() => setError('Could not create the profile.')).finally(() => setBusy(false))
    }}><input aria-label="New profile name" placeholder="New profile name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      <button className="btn primary" disabled={busy || !name.trim()}>Create profile</button></form>
  </Panel>
}
