import { useState, type JSX } from 'react'
import type { ChatMessage, ToolStep, ActionClass } from '@shared/types'
import { Markdown } from '../markdown'

const GLYPH: Record<ToolStep['status'], string> = {
  pending: '◦', awaiting_approval: '?', running: '◍', done: '✓', error: '✕', denied: '⊘'
}

const CLASS_LABEL: Record<ActionClass, string> = {
  read: 'reads',
  local_reversible: 'changes something in Voyager — undoable',
  external_draft: 'drafts, without sending',
  external_write: 'writes to a service outside Voyager',
  sensitive: 'is sensitive — money, deletion, or credentials'
}

function Step({ step }: { step: ToolStep }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        className={`step${step.status === 'error' ? ' err' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title={CLASS_LABEL[step.actionClass]}
      >
        <span className="glyph">{GLYPH[step.status]}</span>
        <span className="name">{step.name}</span>
        {step.status === 'denied' && <span className="badge warn">declined</span>}
      </button>
      {open && (
        <div className="step-out">
          {JSON.stringify(step.input, null, 2)}
          {step.output ? `\n\n→ ${step.output}` : ''}
        </div>
      )}
    </div>
  )
}

interface Props {
  msg: ChatMessage
  streaming: boolean
  onApprove: (stepId: string, ok: boolean) => void
}

export default function Message({ msg, streaming, onApprove }: Props): JSX.Element {
  const [showThinking, setShowThinking] = useState(false)
  const pending = msg.steps.filter((s) => s.status === 'awaiting_approval')

  if (msg.role === 'user') {
    return (
      <div className="msg user">
        {msg.attachments.length > 0 && (
          <div className="chips">
            {msg.attachments.map((a) => (
              <span className="chip" key={a.id}><span className="t">{a.label}</span></span>
            ))}
          </div>
        )}
        <div className="bubble">{msg.text}</div>
      </div>
    )
  }

  return (
    <div className="msg assistant">
      {msg.thinking && (
        <>
          <button className="thinking-toggle" onClick={() => setShowThinking((s) => !s)}>
            {showThinking ? '▾' : '▸'} {streaming && !msg.text ? 'Thinking…' : 'Thinking'}
          </button>
          {showThinking && <div className="thinking">{msg.thinking}</div>}
        </>
      )}

      {msg.steps.filter((s) => s.status !== 'awaiting_approval').map((s) => (
        <Step key={s.id} step={s} />
      ))}

      {pending.map((s) => (
        <div className="approval" key={s.id}>
          <div className="what">Allow <code>{s.name}</code>?</div>
          <div className="why">
            This {CLASS_LABEL[s.actionClass]}.
            <br />
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
              {JSON.stringify(s.input).slice(0, 300)}
            </span>
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => onApprove(s.id, true)}>Allow once</button>
            <button className="btn" onClick={() => onApprove(s.id, false)}>Decline</button>
          </div>
        </div>
      ))}

      {msg.error
        ? <div className="bubble" style={{ color: 'var(--danger)' }}>{msg.error}</div>
        : <div className="bubble"><Markdown text={msg.text} /></div>}

      {streaming && !msg.text && !msg.thinking && (
        <div className="step"><span className="glyph">◍</span> Working…</div>
      )}

      {msg.citations.length > 0 && (
        <div className="citations">
          {msg.citations.map((c, i) => (
            <button className="citation" key={`${c.url}-${i}`}
              onClick={() => window.voyager.tabs.create({ url: c.url, background: true })}
              title={c.url}>
              <span className="n">{i + 1}</span>
              <span className="t">{c.title || c.url}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
