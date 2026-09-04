import { useEffect, useRef, useState, type JSX } from 'react'

export default function FindBar({ onClose }: { onClose: () => void }): JSX.Element {
  const [q, setQ] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  useEffect(() => () => window.kia.find(''), [])

  return (
    <div className="findbar">
      <input
        ref={input}
        value={q}
        placeholder="Find in page"
        onChange={(e) => { setQ(e.target.value); window.kia.find(e.target.value, true) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') window.kia.find(q, !e.shiftKey)
          if (e.key === 'Escape') { window.kia.find(''); onClose() }
        }}
      />
      <button className="iconbtn" title="Previous (⇧↵)" onClick={() => window.kia.find(q, false)}>↑</button>
      <button className="iconbtn" title="Next (↵)" onClick={() => window.kia.find(q, true)}>↓</button>
      <button className="iconbtn" title="Close (Esc)"
        onClick={() => { window.kia.find(''); onClose() }}>×</button>
    </div>
  )
}
