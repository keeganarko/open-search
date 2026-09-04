import { useEffect, useRef, useState, type JSX } from 'react'

export default function FindBar({ onClose }: { onClose: () => void }): JSX.Element {
  const [q, setQ] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  useEffect(() => () => window.voyager.find(''), [])

  return (
    <div className="findbar">
      <input
        ref={input}
        value={q}
        placeholder="Find in page"
        onChange={(e) => { setQ(e.target.value); window.voyager.find(e.target.value, true) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') window.voyager.find(q, !e.shiftKey)
          if (e.key === 'Escape') { window.voyager.find(''); onClose() }
        }}
      />
      <button className="iconbtn" title="Previous (⇧↵)" onClick={() => window.voyager.find(q, false)}>↑</button>
      <button className="iconbtn" title="Next (↵)" onClick={() => window.voyager.find(q, true)}>↓</button>
      <button className="iconbtn" title="Close (Esc)"
        onClick={() => { window.voyager.find(''); onClose() }}>×</button>
    </div>
  )
}
