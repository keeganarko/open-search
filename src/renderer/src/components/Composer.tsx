import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import type { ContextRef, Skill } from '@shared/types'

interface Props {
  busy: boolean
  attachments: ContextRef[]
  setAttachments: (a: ContextRef[]) => void
  skill: Skill | null
  setSkill: (s: Skill | null) => void
  onSend: (text: string) => void
  onStop: () => void
  focusToken: number
}

type AcMode = { kind: 'at'; from: number } | { kind: 'slash'; from: number } | null

export default function Composer({
  busy, attachments, setAttachments, skill, setSkill, onSend, onStop, focusToken
}: Props): JSX.Element {
  const [text, setText] = useState('')
  const [ac, setAc] = useState<AcMode>(null)
  const [candidates, setCandidates] = useState<ContextRef[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [sel, setSel] = useState(0)
  const ta = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { ta.current?.focus() }, [focusToken])

  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(190, el.scrollHeight)}px`
  }, [text])

  // Open the picker on "@" (context) or "/" at the start (skills).
  const onChange = (v: string): void => {
    setText(v)
    const caret = ta.current?.selectionStart ?? v.length
    const before = v.slice(0, caret)
    const at = before.lastIndexOf('@')
    const slash = before.lastIndexOf('/')

    if (at >= 0 && !/\s/.test(before.slice(at + 1))) {
      setAc({ kind: 'at', from: at })
      setSel(0)
      void window.kia.page.candidates().then(setCandidates)
    } else if (slash === 0) {
      setAc({ kind: 'slash', from: 0 })
      setSel(0)
      void window.kia.skills.list().then(setSkills)
    } else {
      setAc(null)
    }
  }

  const query = ac ? text.slice(ac.from + 1, ta.current?.selectionStart ?? text.length).toLowerCase() : ''
  const shownCandidates = candidates
    .filter((c) => c.label.toLowerCase().includes(query) || (c.detail ?? '').toLowerCase().includes(query))
    .slice(0, 8)
  const shownSkills = skills
    .filter((s) => s.slug.startsWith(query) || s.name.toLowerCase().includes(query))
    .slice(0, 8)
  const acLen = ac?.kind === 'at' ? shownCandidates.length : ac ? shownSkills.length : 0

  const accept = (i: number): void => {
    if (!ac) return
    const caret = ta.current?.selectionStart ?? text.length
    if (ac.kind === 'at') {
      const c = shownCandidates[i]
      if (!c) return
      if (!attachments.some((a) => a.id === c.id && a.type === c.type)) {
        setAttachments([...attachments, c])
      }
      setText(text.slice(0, ac.from) + text.slice(caret))
    } else {
      const s = shownSkills[i]
      if (!s) return
      setSkill(s)
      setText(text.slice(caret))
    }
    setAc(null)
    ta.current?.focus()
  }

  const submit = (): void => {
    const t = text.trim()
    if (!t && !skill) return
    onSend(t)
    setText('')
    setAc(null)
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (ac && acLen > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); return setSel((s) => (s + 1) % acLen) }
      if (e.key === 'ArrowUp') { e.preventDefault(); return setSel((s) => (s - 1 + acLen) % acLen) }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); return accept(sel) }
      if (e.key === 'Escape') { e.preventDefault(); return setAc(null) }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
    if (e.key === 'Backspace' && !text && skill) setSkill(null)
  }

  return (
    <div className="composer">
      {(attachments.length > 0 || skill) && (
        <div className="chips">
          {skill && (
            <span className="chip skill">
              <span className="t">/{skill.slug}</span>
              <button className="x" onClick={() => setSkill(null)}>×</button>
            </span>
          )}
          {attachments.map((a) => (
            <span className="chip" key={`${a.type}:${a.id}`}>
              <span className="t">{a.label}</span>
              <button className="x"
                onClick={() => setAttachments(attachments.filter((x) => x.id !== a.id || x.type !== a.type))}
              >×</button>
            </span>
          ))}
        </div>
      )}

      <div className="composer-box" style={{ position: 'relative' }}>
        {ac && acLen > 0 && (
          <div className="autocomplete">
            {ac.kind === 'at'
              ? shownCandidates.map((c, i) => (
                  <button key={`${c.type}:${c.id}`} className={`ac-item${i === sel ? ' sel' : ''}`}
                    onMouseEnter={() => setSel(i)} onClick={() => accept(i)}>
                    <span className="n">{c.label}</span>
                    <span className="d">{c.detail ?? c.type}</span>
                  </button>
                ))
              : shownSkills.map((s, i) => (
                  <button key={s.id} className={`ac-item${i === sel ? ' sel' : ''}`}
                    onMouseEnter={() => setSel(i)} onClick={() => accept(i)}>
                    <span className="n">/{s.slug}</span>
                    <span className="d">{s.description}</span>
                  </button>
                ))}
          </div>
        )}

        <textarea
          ref={ta}
          rows={1}
          value={text}
          placeholder={skill ? `${skill.name} — add anything else…` : 'Ask about this page, or @ a tab…'}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
        />

        <div className="composer-row">
          <button className="iconbtn" title="Attach a tab or your selection (@)"
            onClick={() => { onChange(`${text}@`); ta.current?.focus() }}>@</button>
          <button className="iconbtn" title="Run a skill (/)"
            onClick={() => { setText(`/${text}`); onChange(`/${text}`); ta.current?.focus() }}>/</button>
          <span className="spacer" />
          {busy
            ? <button className="btn" onClick={onStop}>Stop</button>
            : <button className="btn primary" onClick={submit} disabled={!text.trim() && !skill}>Send</button>}
        </div>
      </div>
      <div className="composer-hint" style={{ marginTop: 5 }}>
        ↵ send · ⇧↵ newline · @ context · / skills
      </div>
    </div>
  )
}
