import { useEffect, useRef, type JSX } from 'react'

/**
 * The opening story: a scribble animatic that hard-cuts about six times a
 * second. There is no tweening anywhere in here on purpose — cuts read as
 * faster than motion, and the whole thing is over in five seconds.
 *
 * Two cheap tricks do all the work. Every stroke is drawn as a jittered
 * polyline rather than a line, and the jitter is reseeded on every animation
 * frame, so the drawing "boils" the way hand-inked animation does. That is what
 * makes eleven straight lines feel alive.
 */

const BEAT = 165          // ms per shot
const FADE = 260          // ms to get out of the way

/** A stroke: points in 0–1 space, so the story scales to any window. */
type Pt = [number, number]

interface Shot {
  /** Drawn as an open polyline. */
  lines?: Pt[][]
  /** Rectangles, as [x, y, w, h] in 0–1 space. */
  boxes?: [number, number, number, number][]
}

/**
 * The story, one entry per shot:
 * someone alone → a window → too many windows → they give up → something
 * arrives → it sorts the mess → they stand back up → the name.
 * Repeated entries are held beats; the boil keeps them from looking frozen.
 */
/** A ring, as a rough polygon. Eight points is enough to read as a head. */
const ring = (cx: number, cy: number, rx: number, ry: number): Pt[] =>
  Array.from({ length: 9 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as Pt
  })

/**
 * A stick figure standing on `y`, `h` tall. `slump` bends them forward and
 * shortens them, which is the whole of the acting in this film.
 */
const person = (x: number, y: number, h = 0.30, slump = 0): Pt[][] => {
  const top = y - h * (1 - slump * 1.6)
  const headR = h * 0.11
  const neck = top + headR * 2
  const hip = y - h * 0.36
  const lean = slump * h * 0.5
  return [
    ring(x + lean * 0.7, top + headR, headR * 0.82, headR),
    [[x + lean, neck], [x, hip]],
    [[x - h * 0.20, neck + h * 0.16 + lean], [x + lean * 0.6, neck + h * 0.10],
      [x + h * 0.20, neck + h * 0.16 + lean]],
    [[x, hip], [x - h * 0.13, y]],
    [[x, hip], [x + h * 0.13, y]]
  ]
}

const ground: Pt[][] = [[[0.10, 0.80], [0.90, 0.80]]]

const mess: [number, number, number, number][] = [
  [0.28, 0.10, 0.22, 0.16], [0.46, 0.06, 0.24, 0.17], [0.20, 0.24, 0.21, 0.15],
  [0.54, 0.22, 0.23, 0.16], [0.35, 0.18, 0.26, 0.18], [0.62, 0.10, 0.20, 0.14],
  [0.15, 0.08, 0.19, 0.14]
]
const tidy = (n: number): [number, number, number, number][] =>
  Array.from({ length: n }, (_, i) => [0.20 + i * 0.145, 0.14, 0.125, 0.18])

const bird = (x: number, y: number): Pt[][] => [
  [[x - 0.055, y], [x, y - 0.035], [x + 0.055, y]],
  [[x - 0.02, y + 0.012], [x, y - 0.035], [x + 0.02, y + 0.012]]
]

/**
 * "open search", as strokes. A real typeface next to all this scribble looks
 * like a different film, so the name gets drawn by the same hand as the rest.
 *
 * Glyph space is 0–1 tall with the baseline at 1 and the x-height top at 0.34,
 * so ascenders start at 0 and `p` is the only thing allowed below 1.
 */
const GLYPHS: Record<string, { w: number; strokes: Pt[][] }> = {
  o: { w: 0.70, strokes: [[...ring(0.33, 0.67, 0.33, 0.33)]] },
  p: {
    w: 0.70,
    strokes: [[[0.02, 0.36], [0.02, 1.35]], [...ring(0.35, 0.67, 0.33, 0.33)]]
  },
  // One continuous stroke, the way a hand writes it: crossbar out to the right,
  // up over the top, down the left, round the bottom.
  e: {
    w: 0.68,
    strokes: [[
      [0.09, 0.67], [0.60, 0.67], [0.63, 0.52], [0.50, 0.38], [0.32, 0.34],
      [0.14, 0.40], [0.03, 0.56], [0.02, 0.72], [0.10, 0.90], [0.28, 1.00],
      [0.48, 0.98], [0.62, 0.88]
    ]]
  },
  n: {
    w: 0.62,
    strokes: [
      [[0.02, 0.34], [0.02, 1]],
      [[0.02, 0.50], [0.10, 0.38], [0.28, 0.34], [0.48, 0.40], [0.56, 0.56], [0.56, 1]]
    ]
  },
  s: {
    w: 0.58,
    strokes: [[
      [0.56, 0.44], [0.44, 0.35], [0.22, 0.34], [0.08, 0.42], [0.10, 0.55],
      [0.30, 0.63], [0.50, 0.72], [0.52, 0.88], [0.36, 0.99], [0.14, 0.98],
      [0.02, 0.90]
    ]]
  },
  a: { w: 0.70, strokes: [[...ring(0.32, 0.67, 0.32, 0.33)], [[0.64, 0.34], [0.64, 1]]] },
  r: {
    w: 0.50,
    strokes: [
      [[0.02, 0.34], [0.02, 1]],
      [[0.02, 0.54], [0.12, 0.39], [0.32, 0.33], [0.50, 0.35]]
    ]
  },
  c: {
    w: 0.62,
    strokes: [[
      [0.60, 0.46], [0.48, 0.36], [0.28, 0.34], [0.12, 0.44], [0.04, 0.62],
      [0.06, 0.82], [0.20, 0.97], [0.40, 1.00], [0.58, 0.92]
    ]]
  },
  h: {
    w: 0.62,
    strokes: [
      [[0.02, 0], [0.02, 1]],
      [[0.02, 0.50], [0.10, 0.38], [0.28, 0.34], [0.48, 0.40], [0.56, 0.56], [0.56, 1]]
    ]
  }
}
/** Letters advance by their own width, or "ki a" is what you get. */
const word = (text: string, cx: number, cy: number, size: number): Pt[][] => {
  const gap = 0.13
  const total = [...text].reduce((n, ch) => n + (GLYPHS[ch]?.w ?? 0.4) + gap, -gap)
  let x = cx - (total * size) / 2
  const out: Pt[][] = []
  for (const ch of text) {
    const g = GLYPHS[ch]
    if (!g) continue
    for (const stroke of g.strokes) {
      out.push(stroke.map(([px, py]) => [x + px * size, cy + (py - 0.5) * size] as Pt))
    }
    x += (g.w + gap) * size
  }
  return out
}

/** Two lines, because one line of "open search" runs off both edges. */
const NAME: Pt[][] = [
  ...word('open', 0.5, 0.355, 0.16),
  ...word('search', 0.5, 0.595, 0.16)
]

/**
 * The storyboard, one entry per cut: someone alone → a window → too many
 * windows → they give up → something arrives → it sorts the mess → they stand
 * back up → the name. Repeated entries are held beats; the boil keeps a held
 * beat from reading as a freeze.
 */
const STORY: Shot[] = [
  {},
  { lines: ground },
  { lines: [...ground, ...person(0.5, 0.8)] },
  { lines: [...ground, ...person(0.5, 0.8)] },
  { lines: [...ground, ...person(0.5, 0.8)], boxes: [mess[0]] },
  { lines: [...ground, ...person(0.5, 0.8)], boxes: mess.slice(0, 2) },
  { lines: [...ground, ...person(0.5, 0.8)], boxes: mess.slice(0, 4) },
  { lines: [...ground, ...person(0.5, 0.8)], boxes: mess.slice(0, 6) },
  { lines: [...ground, ...person(0.5, 0.8)], boxes: mess },
  { lines: [...ground, ...person(0.5, 0.8)], boxes: mess },
  { lines: [...ground, ...person(0.5, 0.8, 0.30, 0.10)], boxes: mess },
  { lines: [...ground, ...person(0.5, 0.8, 0.30, 0.20)], boxes: mess },
  { lines: [...ground, ...person(0.5, 0.8, 0.30, 0.20)], boxes: mess },
  { lines: [...ground, ...person(0.5, 0.8, 0.30, 0.20), ...bird(0.10, 0.50)], boxes: mess },
  { lines: [...ground, ...person(0.5, 0.8, 0.30, 0.20), ...bird(0.30, 0.44)], boxes: mess },
  { lines: [...ground, ...person(0.5, 0.8, 0.30, 0.18), ...bird(0.52, 0.46)], boxes: mess.slice(0, 5) },
  { lines: [...ground, ...person(0.5, 0.8, 0.30, 0.12), ...bird(0.74, 0.42)], boxes: mess.slice(0, 3) },
  { lines: [...ground, ...person(0.5, 0.8, 0.30, 0.05), ...bird(0.90, 0.36)], boxes: tidy(3) },
  { lines: [...ground, ...person(0.5, 0.8)], boxes: tidy(4) },
  { lines: [...ground, ...person(0.5, 0.8)], boxes: tidy(5) },
  { lines: [...ground, ...person(0.5, 0.8), [[0.5, 0.50], [0.5, 0.34]]], boxes: tidy(5) },
  { lines: [...ground, ...person(0.5, 0.8), [[0.5, 0.50], [0.5, 0.34]]], boxes: tidy(5) },
  { lines: [...ground, ...person(0.5, 0.8)], boxes: tidy(5) },
  { boxes: tidy(5) },
  {},
  { lines: NAME },
  { lines: NAME },
  { lines: NAME },
  { lines: NAME }
]

export default function Splash({ onDone }: { onDone: () => void }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const done = useRef(false)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) { onDone(); return }

    const dark = document.documentElement.dataset.theme === 'dark'
    const ink = dark ? '#e8e6e1' : '#1b1a17'
    const paper = dark ? '#141416' : '#f6f6f7'

    let raf = 0
    const t0 = performance.now()

    /** A straight line, drawn crooked. Two passes, because one looks deliberate. */
    const rough = (x1: number, y1: number, x2: number, y2: number, amp: number): void => {
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath()
        const steps = 5
        for (let i = 0; i <= steps; i++) {
          const t = i / steps
          const x = x1 + (x2 - x1) * t + (Math.random() - 0.5) * amp
          const y = y1 + (y2 - y1) * t + (Math.random() - 0.5) * amp
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
    }

    const draw = (now: number): void => {
      const w = canvas.width = canvas.clientWidth * devicePixelRatio
      const h = canvas.height = canvas.clientHeight * devicePixelRatio
      const s = Math.min(w, h)
      const amp = s * 0.006

      ctx.fillStyle = paper
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = ink
      ctx.fillStyle = ink
      ctx.lineWidth = Math.max(1.5, s * 0.004)
      ctx.lineCap = 'round'

      // rAF hands you the time the frame *began*, which can be a hair earlier
      // than the `performance.now()` captured just before requesting it — so
      // this clamps at both ends, not just the top.
      const beat = Math.floor((now - t0) / BEAT)
      const shot = STORY[Math.max(0, Math.min(STORY.length - 1, beat))]

      for (const line of shot.lines ?? []) {
        for (let i = 0; i < line.length - 1; i++) {
          rough(line[i][0] * w, line[i][1] * h, line[i + 1][0] * w, line[i + 1][1] * h, amp)
        }
      }
      for (const [x, y, bw, bh] of shot.boxes ?? []) {
        const px = x * w, py = y * h, pw = bw * w, ph = bh * h
        rough(px, py, px + pw, py, amp)
        rough(px + pw, py, px + pw, py + ph, amp)
        rough(px + pw, py + ph, px, py + ph, amp)
        rough(px, py + ph, px, py, amp)
        // One squiggle inside, so a rectangle reads as a page.
        rough(px + pw * 0.15, py + ph * 0.3, px + pw * 0.7, py + ph * 0.3, amp)
      }

      if (now - t0 > STORY.length * BEAT) { finish(); return }
      raf = requestAnimationFrame(draw)
    }

    const finish = (): void => {
      if (done.current) return
      done.current = true
      cancelAnimationFrame(raf)
      canvas.style.transition = `opacity ${FADE}ms ease-out`
      canvas.style.opacity = '0'
      setTimeout(onDone, FADE)
    }

    raf = requestAnimationFrame(draw)
    // Any intent to use the browser cuts the story short.
    for (const e of ['pointerdown', 'keydown', 'wheel']) {
      addEventListener(e, finish, { once: true, capture: true, passive: true })
    }
    return () => {
      cancelAnimationFrame(raf)
      for (const e of ['pointerdown', 'keydown', 'wheel']) removeEventListener(e, finish, true)
    }
  }, [onDone])

  return <canvas ref={ref} className="splash" />
}
