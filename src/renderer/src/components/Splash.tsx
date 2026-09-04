import VoyagerMark from './VoyagerMark'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'

const DISPLAY_MS = 4_200
const EXIT_MS = 600
const REDUCED_DISPLAY_MS = 900
const REDUCED_EXIT_MS = 120

/**
 * A slow wordmark reveal with a single orbital trace. Leave a quiet beat for
 * the complete name before the white field yields to the browser.
 */
export default function Splash({ onDone }: { onDone: () => void }): JSX.Element {
  const [exiting, setExiting] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  const finishing = useRef(false)
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)')
    const update = (): void => setReducedMotion(preference.matches)
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  const finish = useCallback(() => {
    if (finishing.current) return
    finishing.current = true
    setExiting(true)
  }, [])

  useEffect(() => {
    if (!exiting) return
    exitTimer.current = setTimeout(onDone, reducedMotion ? REDUCED_EXIT_MS : EXIT_MS)
    return () => {
      if (exitTimer.current) clearTimeout(exitTimer.current)
    }
  }, [exiting, onDone, reducedMotion])

  useEffect(() => {
    const displayTimer = setTimeout(finish, reducedMotion ? REDUCED_DISPLAY_MS : DISPLAY_MS)

    // Intent always wins over branding: using the browser dismisses the mark.
    for (const event of ['pointerdown', 'keydown', 'wheel']) {
      addEventListener(event, finish, { once: true, capture: true, passive: true })
    }

    return () => {
      clearTimeout(displayTimer)
      for (const event of ['pointerdown', 'keydown', 'wheel']) {
        removeEventListener(event, finish, true)
      }
    }
  }, [finish, reducedMotion])

  return (
    <div
      className={`splash${exiting ? ' splash--exiting' : ''}`}
      style={{ '--splash-exit-duration': `${reducedMotion ? REDUCED_EXIT_MS : EXIT_MS}ms` } as CSSProperties}
      role="img"
      aria-label="Voyager"
    >
      <div className="splash__signature" aria-hidden="true">
        <svg className="splash__orbit" viewBox="0 0 640 280" fill="none">
          <path
            className="splash__orbit-trail"
            d="M 510 58 C 352 -2 98 36 53 131 C 2 242 370 278 538 184 C 619 139 598 89 552 74"
            pathLength="1"
          />
          <path className="splash__star" d="M 552 65 Q 552 74 561 74 Q 552 74 552 83 Q 552 74 543 74 Q 552 74 552 65 Z" />
        </svg>
        <div className="splash__reveal">
          <div className="splash__wordmark"><VoyagerMark size={64} /> Voyager</div>
        </div>
      </div>
    </div>
  )
}
