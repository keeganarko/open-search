import { useState, type JSX } from 'react'

/** Local brand artwork and initials work offline and disclose no bookmark URLs. */
export default function SiteIcon({ url, title, favicon }: {
  url: string; title: string; favicon?: string | null
}): JSX.Element {
  const [failed, setFailed] = useState<string | null>(null)
  let host = ''
  try { host = new URL(url).hostname.replace(/^www\./, '') } catch { /* initial below */ }
  const image = favicon && favicon.length <= 90_000
    && /^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/=]+$/i.test(favicon)
    && failed !== favicon ? favicon : null
  if (image) return <img className="site-icon" src={image} alt="" onError={() => setFailed(image)} />
  if (host === 'mail.google.com' || host === 'gmail.com') return (
    <svg className="site-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M2 6.5 6 9.5V20H3a1 1 0 0 1-1-1Z" fill="#4285f4" />
      <path d="M18 9.5 22 6.5V19a1 1 0 0 1-1 1h-3Z" fill="#34a853" />
      <path d="m2 6.5 4 3V4.8L4.7 3.8A1.7 1.7 0 0 0 2 5.2Z" fill="#c5221f" />
      <path d="m18 4.8 1.3-1A1.7 1.7 0 0 1 22 5.2v1.3l-4 3Z" fill="#fbbc04" />
      <path d="m6 4.8 6 4.5 6-4.5v4.7L12 14 6 9.5Z" fill="#ea4335" />
    </svg>
  )
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') return (
    <svg className="site-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="4" width="22" height="16" rx="5" fill="#f03" />
      <path d="m10 8 6 4-6 4Z" fill="#fff" />
    </svg>
  )
  return <span className="site-icon site-initial" aria-hidden="true">{Array.from(title.trim() || host || '·')[0].toUpperCase()}</span>
}
