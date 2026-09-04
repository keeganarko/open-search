/**
 * Voyager's startup signature is synthesized in the renderer. Keeping the
 * sound procedural makes it deterministic, compact, and wholly part of the app.
 */

let started = false

/** Plays a short, quiet three-note signature once per launch. */
export async function playStartupSound(volume: number): Promise<void> {
  if (started) return
  started = true

  const ctx = new AudioContext()
  if (ctx.state === 'suspended') {
    const resume = (): void => { void ctx.resume() }
    for (const event of ['pointerdown', 'keydown']) {
      addEventListener(event, resume, { once: true, capture: true })
    }
  }

  const level = Math.max(0.0001, Math.min(1, volume) * 0.22)
  const master = ctx.createGain()
  const t0 = ctx.currentTime + 0.08
  const end = t0 + 3.1
  master.gain.setValueAtTime(0.0001, t0)
  master.gain.exponentialRampToValueAtTime(level, t0 + 0.18)
  master.gain.setValueAtTime(level, end - 1.2)
  master.gain.exponentialRampToValueAtTime(0.0001, end)
  master.connect(ctx.destination)

  const notes = [261.63, 329.63, 392]
  for (let i = 0; i < notes.length; i++) {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    const start = t0 + i * 0.34
    oscillator.type = i === 2 ? 'sine' : 'triangle'
    oscillator.frequency.setValueAtTime(notes[i], start)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.55 - i * 0.08, start + 0.12)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    oscillator.connect(gain)
    gain.connect(master)
    oscillator.start(start)
    oscillator.stop(end + 0.05)
  }

  setTimeout(() => { void ctx.close() }, Math.ceil((end - ctx.currentTime + 0.2) * 1000))
}
