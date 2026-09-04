import { useState, type JSX } from 'react'
import Panel from './Panel'

/**
 * Decks and reports. Open Search writes both from whatever is open plus the instruction,
 * then hands back a file — it never uploads anything anywhere.
 */
export default function Compose({ onClose, toast }: {
  onClose: () => void; toast: (m: string, k?: 'info' | 'error') => void
}): JSX.Element {
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState<'deck' | 'report' | null>(null)
  const [made, setMade] = useState<{ path: string; title: string } | null>(null)

  const run = async (kind: 'deck' | 'report'): Promise<void> => {
    if (!instruction.trim()) return
    setBusy(kind)
    setMade(null)
    try {
      const r = kind === 'deck'
        ? await window.kia.compose.deck(instruction)
        : await window.kia.compose.report(instruction)
      setMade(r)
      toast(`Saved to ${r.path}`)
    } catch (e) { toast(String((e as Error).message), 'error') }
    setBusy(null)
  }

  return (
    <Panel title="Make a deck or a report" onClose={onClose} narrow>
      <div className="field">
        <label>What should it cover?</label>
        <div className="desc">
          Open Search reads your open tabs and searches the web where it needs to. Say who it is for and
          what it has to land — that matters more than the topic.
        </div>
        <textarea rows={6} autoFocus value={instruction}
          placeholder="A six-slide deck for Thursday's review: what changed in the pricing page tests, what we recommend, and what we need a decision on."
          onChange={(e) => setInstruction(e.target.value)} />
      </div>
      <div className="row">
        <button className="btn primary" disabled={!!busy || !instruction.trim()}
          onClick={() => run('deck')}>
          {busy === 'deck' ? 'Building…' : 'Make a deck (.pptx)'}
        </button>
        <button className="btn" disabled={!!busy || !instruction.trim()}
          onClick={() => run('report')}>
          {busy === 'report' ? 'Writing…' : 'Write a report (.md)'}
        </button>
      </div>
      {made && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="t">{made.title}</div>
          <div className="s">{made.path}</div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={() => window.kia.compose.reveal(made.path)}>
              Show in Finder
            </button>
          </div>
        </div>
      )}
    </Panel>
  )
}
