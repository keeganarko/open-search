import VoyagerMark from './VoyagerMark'
import { useCallback, useEffect, useRef, useState, type JSX } from 'react'

const DISPLAY_MS = 2_100
const EXIT_MS = 360

/**
 * A deliberately quiet launch mark. The word is revealed in its direction of
 * travel, then the white field yields to the browser without another visual.
 */
export default function Splash({ onDone }: { onDone: () => void }): JSX.Element {
  const [exiting, setExiting] = useState(false)
  const finishing = useRef(false)
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const finish = useCallback(() => {
    if (finishing.current) return
    finishing.current = true
    setExiting(true)
    exitTimer.current = setTimeout(onDone, EXIT_MS)
  }, [onDone])

  useEffect(() => {
    const displayTimer = setTimeout(finish, DISPLAY_MS)

    // Intent always wins over branding: using the browser dismisses the mark.
    for (const event of ['pointerdown', 'keydown', 'wheel']) {
      addEventListener(event, finish, { once: true, capture: true, passive: true })
    }

    return () => {
      clearTimeout(displayTimer)
      if (exitTimer.current) clearTimeout(exitTimer.current)
      for (const event of ['pointerdown', 'keydown', 'wheel']) {
        removeEventListener(event, finish, true)
      }
    }
  }, [finish])

  return (
    <div
      className={`splash${exiting ? ' splash--exiting' : ''}`}
      aria-label="Voyager"
    >
      <div className="splash__reveal">
        <div className="splash__wordmark"><VoyagerMark size={64} /> Voyager</div>
      </div>
    </div>
  )
}
