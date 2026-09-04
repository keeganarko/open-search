/**
 * The opening sound.
 *
 * Two assets, both derived from the Big Buck Bunny theme (CC BY 3.0, Blender
 * Foundation — see `public/sounds/NOTICE.md`):
 *
 * - `kia-open.webm` — twelve seconds of the theme as written, for the launch.
 * - `kia-settle.wav` — the same phrase an octave down, filtered dark and put
 *   through a long reverb, closed into a seamless thirteen-second loop.
 *
 * The loop is WAV on purpose. Opus writes a pre-skip and a padded final packet,
 * so a decoded Opus file is a few milliseconds longer than what went in and the
 * loop point lands in the wrong place — a click, every thirteen seconds. WAV
 * decodes sample-for-sample.
 *
 * The bed keeps playing until the user does something, then fades. Music over
 * someone's work is intrusive; music while they are still looking at a launch
 * screen is not.
 */

/** Where the intro hands over to the bed. Both ramps share this window. */
const CROSSFADE = 3.5
/** How long the bed takes to leave once the user starts working. */
const FADE_OUT = 4
/** The bed stops on its own eventually, even if nobody touches anything. */
const MAX_BED = 150

let started = false

/**
 * The bytes arrive from main over IPC rather than being fetched. In production
 * the chrome is loaded with `loadFile`, so its origin is `file://`, and
 * Chromium refuses a same-directory `fetch` from an opaque origin. A structured
 * clone may also hand back a view into a larger buffer, hence the slice.
 */
function decode(ctx: AudioContext, bytes: Uint8Array): Promise<AudioBuffer> {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return ctx.decodeAudioData(ab as ArrayBuffer)
}

/**
 * Plays the opening once per launch. Safe to call again — it no-ops.
 * Resolves when the sound has been scheduled, not when it has finished.
 */
export async function playStartupSound(
  volume: number, openBytes: Uint8Array, settleBytes: Uint8Array
): Promise<void> {
  if (started) return
  started = true

  const ctx = new AudioContext()
  // With `autoplayPolicy: 'no-user-gesture-required'` the context starts
  // running. If that ever changes, this is the difference between silence and
  // a sound that arrives late rather than not at all.
  if (ctx.state === 'suspended') {
    const resume = (): void => { void ctx.resume() }
    for (const e of ['pointerdown', 'keydown']) {
      addEventListener(e, resume, { once: true, capture: true })
    }
  }

  const master = ctx.createGain()
  master.gain.value = Math.max(0, Math.min(1, volume))
  master.connect(ctx.destination)

  const [open, settle] = await Promise.all([
    decode(ctx, openBytes),
    decode(ctx, settleBytes)
  ])

  const t0 = ctx.currentTime + 0.1
  // The intro's own fades are baked into the file; this ramp only covers the
  // handover, which is why it starts late rather than at t0.
  const handover = t0 + Math.max(0, open.duration - CROSSFADE)

  const introGain = ctx.createGain()
  introGain.connect(master)
  introGain.gain.setValueAtTime(1, handover)
  introGain.gain.linearRampToValueAtTime(0, handover + CROSSFADE)

  const intro = ctx.createBufferSource()
  intro.buffer = open
  intro.connect(introGain)
  intro.start(t0)

  const bedGain = ctx.createGain()
  bedGain.connect(master)
  // 0.55 because the bed is meant to sit under whatever comes next, not
  // continue the performance at the same level.
  bedGain.gain.setValueAtTime(0.0001, handover)
  bedGain.gain.exponentialRampToValueAtTime(0.55, handover + CROSSFADE)

  const bed = ctx.createBufferSource()
  bed.buffer = settle
  // The whole point of the WAV: `loop` restarts at sample zero with no gap,
  // and the file's head and tail were crossfaded to meet there.
  bed.loop = true
  bed.connect(bedGain)
  bed.start(handover)

  let ending = false
  const end = (): void => {
    if (ending) return
    ending = true
    const now = ctx.currentTime
    bedGain.gain.cancelScheduledValues(now)
    bedGain.gain.setValueAtTime(Math.max(0.0001, bedGain.gain.value), now)
    bedGain.gain.exponentialRampToValueAtTime(0.0001, now + FADE_OUT)
    bed.stop(now + FADE_OUT + 0.1)
    bed.onended = () => { void ctx.close() }
  }

  // Any real intent to use the browser ends the music. Waiting until the bed is
  // actually up avoids a stray click during the intro killing it instantly.
  const arm = (): void => {
    for (const e of ['pointerdown', 'keydown', 'wheel']) {
      addEventListener(e, end, { once: true, capture: true, passive: true })
    }
    setTimeout(end, MAX_BED * 1000)
  }
  setTimeout(arm, (handover - ctx.currentTime + CROSSFADE) * 1000)
}
