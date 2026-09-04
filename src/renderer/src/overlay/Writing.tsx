import { useEffect, useRef, useState, type JSX } from 'react'

interface Rect { x: number; y: number; width: number; height: number }

const QUICK = [
  ['Tighten', 'Cut it to the shortest version that keeps every fact.'],
  ['Warmer', 'Same content, warmer and more human. No exclamation marks.'],
  ['More formal', 'Rewrite in a formal register suitable for external email.'],
  ['Fix grammar', 'Correct grammar, spelling and punctuation. Change nothing else.'],
  ['Bullets', 'Turn this into a tight bulleted list.'],
  ['Expand', 'Expand this into a full paragraph, keeping the argument.']
] as const

export default function Writing({ anchor, tabId, onClose }: {
  anchor: Rect; tabId: string; onClose: () => void
}): JSX.Element {
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { input.current?.focus() }, [])

  const run = async (text: string): Promise<void> => {
    if (!text.trim()) return
    setBusy(true)
    setError(null)
    try {
      const r = await window.voyager.writing.request(text, tabId)
      setResult(r.rewritten)
    } catch (e) { setError(String((e as Error).message)) }
    setBusy(false)
  }

  const top = Math.min(anchor.y + anchor.height + 8, window.innerHeight - 300)
  const left = Math.min(Math.max(8, anchor.x), window.innerWidth - 540)

  return (
    <>
      <div style={{ position: 'fixed', inset: 0 }} onClick={onClose} />
      <div className="writing" style={{ top, left }}>
        <div className="quick">
          {QUICK.map(([label, prompt]) => (
            <button className="btn" key={label} disabled={busy} onClick={() => void run(prompt)}>
              {label}
            </button>
          ))}
        </div>
        <input
          ref={input}
          type="text"
          style={{ width: '100%' }}
          placeholder="…or say what to change"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void run(instruction) }}
        />

        {busy && <div className="result">Rewriting…</div>}
        {error && <div className="result" style={{ color: 'var(--danger)' }}>{error}</div>}
        {result && <div className="result">{result}</div>}

        {result && (
          <div className="row">
            <button className="btn primary" onClick={async () => {
              const applied = await window.voyager.writing.apply(result, true, tabId)
              if (applied) onClose()
              else setError('The page or selection changed. Select the text and rewrite it again.')
            }}>Replace selection</button>
            <button className="btn" onClick={async () => {
              await window.voyager.copy(result)
              onClose()
            }}>Copy</button>
            <button className="btn" onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </>
  )
}
