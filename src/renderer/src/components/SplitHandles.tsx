import { useEffect, useRef, useState, type JSX } from 'react'
import type { SplitLayout } from '@shared/types'

const GAP = 8

/**
 * The gaps between split panes are the only part of the content well the chrome
 * still paints, so the resize handles live exactly there.
 */
export default function SplitHandles({ split }: { split: SplitLayout }): JSX.Element | null {
  const [ratios, setRatios] = useState(split.ratios)
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{ i: number; startX: number; start: number[]; usable: number } | null>(null)

  useEffect(() => setRatios(split.ratios), [split.ratios])

  useEffect(() => {
    const move = (e: MouseEvent): void => {
      const d = drag.current
      if (!d) return
      const delta = (e.clientX - d.startX) / d.usable
      const next = [...d.start]
      const a = next[d.i] + delta
      const b = next[d.i + 1] - delta
      if (a < 0.12 || b < 0.12) return
      next[d.i] = a
      next[d.i + 1] = b
      setRatios(next)
    }
    const up = (): void => {
      if (drag.current) {
        window.voyager.layout.ratios(ratios)
        drag.current = null
        document.body.style.cursor = ''
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [ratios])

  if (split.tabIds.length < 2) return null

  const width = box.current?.clientWidth ?? 0
  const usable = width - GAP * (split.tabIds.length - 1)

  let x = 0
  const handles = split.tabIds.slice(0, -1).map((id, i) => {
    x += Math.round(usable * (ratios[i] ?? 1 / split.tabIds.length))
    const left = x
    x += GAP
    return (
      <div
        key={id}
        className="split-handle"
        style={{ left }}
        onMouseDown={(e) => {
          drag.current = { i, startX: e.clientX, start: [...ratios], usable }
          document.body.style.cursor = 'col-resize'
        }}
      />
    )
  })

  return <div ref={box} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}>{handles}</div>
  </div>
}
