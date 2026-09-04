import { useEffect, type JSX } from 'react'

const pretty = (origin: string): string => origin.replace(/^https?:\/\//, '')

/**
 * The password itself never reaches this renderer — main is holding it, and the
 * sheet only says yes or no. That is the whole reason it is a separate flow
 * rather than a form.
 */
export default function SavePassword(
  { origin, username, existing }: { origin: string; username: string; existing: boolean }
): JSX.Element {
  const answer = (accept: boolean): void => window.kia.logins.respondSave(accept)

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') answer(true)
      if (e.key === 'Escape') answer(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  return (
    <div className="scrim top">
      <div className="sheet permission">
        <div className="perm-head">
          <span className="perm-icon">⚿</span>
          <div>
            <div className="perm-title">
              {existing ? 'Update the password' : 'Save this password'} for{' '}
              <strong>{pretty(origin)}</strong>?
            </div>
            <div className="perm-origin">{username} · encrypted with your keychain</div>
          </div>
        </div>
        <div className="perm-actions">
          <button className="btn" onClick={() => answer(false)}>Not now</button>
          <button className="btn primary" onClick={() => answer(true)} autoFocus>
            {existing ? 'Update' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
