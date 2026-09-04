import { useEffect, useState, type JSX } from 'react'
import type { PermissionAsk } from '@shared/types'

/**
 * Wording lives here rather than in a shared table because the sheet is the
 * only place it is read, and a permission Open Search has no phrasing for should still
 * produce a usable prompt rather than a blank one.
 */
const LABEL: Record<string, string> = {
  media: 'use your camera and microphone',
  geolocation: 'know your location',
  notifications: 'send you notifications',
  'display-capture': 'share your screen',
  'clipboard-read': 'read your clipboard',
  midi: 'use your MIDI devices',
  midiSysex: 'send system messages to your MIDI devices',
  'idle-detection': 'know when you step away from the computer',
  'window-management': 'see how your displays are arranged',
  'speaker-selection': 'choose which speaker plays audio',
  'storage-access': 'use its own cookies inside this site',
  'top-level-storage-access': 'use its cookies across sites',
  hid: 'connect to a USB input device',
  serial: 'connect to a serial device',
  usb: 'connect to a USB device'
}

const ICON: Record<string, string> = {
  media: '◉', geolocation: '⌖', notifications: '❐', 'display-capture': '▢',
  'clipboard-read': '⎘', midi: '♪', midiSysex: '♪', 'idle-detection': '◔',
  'window-management': '⊞', 'speaker-selection': '◈', 'storage-access': '⛁',
  'top-level-storage-access': '⛁', hid: '⌨', serial: '⇄', usb: '⏦'
}

/**
 * `media` covers both devices, and a call that only wants a microphone should
 * not read as asking for the camera too.
 */
function describe(ask: PermissionAsk): string {
  if (ask.permission === 'media' && ask.mediaTypes?.length) {
    const wants = new Set(ask.mediaTypes)
    if (wants.has('video') && !wants.has('audio')) return 'use your camera'
    if (wants.has('audio') && !wants.has('video')) return 'use your microphone'
  }
  return LABEL[ask.permission] ?? `use ${ask.permission}`
}

const pretty = (origin: string): string => origin.replace(/^https?:\/\//, '')

export default function Permission({ asks }: { asks: PermissionAsk[] }): JSX.Element | null {
  const ask = asks[0]
  const [remember, setRemember] = useState(true)

  // A second request arriving behind the first must not inherit the checkbox
  // state from a decision the user already made.
  useEffect(() => setRemember(true), [ask?.id])

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (!ask) return
      if (e.key === 'Enter') window.kia.permissions.respond(ask.id, true, remember)
      // Escape is a refusal, and deliberately not a remembered one — dismissing
      // a prompt should not silently block the site forever.
      if (e.key === 'Escape') window.kia.permissions.respond(ask.id, false, false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [ask, remember])

  if (!ask) return null
  const answer = (allowed: boolean): void =>
    window.kia.permissions.respond(ask.id, allowed, remember)

  return (
    <div className="scrim top">
      <div className="sheet permission">
        <div className="perm-head">
          <span className="perm-icon">{ICON[ask.permission] ?? '?'}</span>
          <div>
            <div className="perm-title">
              <strong>{pretty(ask.origin)}</strong> wants to {describe(ask)}.
            </div>
            <div className="perm-origin">{ask.origin}</div>
          </div>
        </div>

        <label className="check perm-remember">
          <input type="checkbox" checked={remember}
            onChange={(e) => setRemember(e.target.checked)} />
          Remember this for {pretty(ask.origin)}
        </label>

        <div className="perm-actions">
          <button className="btn" onClick={() => answer(false)}>Don&apos;t allow</button>
          <button className="btn primary" onClick={() => answer(true)} autoFocus>Allow</button>
        </div>

        {asks.length > 1 && (
          <div className="sheet-foot">{asks.length - 1} more request{asks.length > 2 ? 's' : ''} waiting</div>
        )}
      </div>
    </div>
  )
}
