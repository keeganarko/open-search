import VoyagerMark from './VoyagerMark'
import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { ChatMessage, Conversation, ContextRef, Skill } from '@shared/types'
import type { StreamEvent } from '@shared/ipc'
import Message from './Message'
import Composer from './Composer'
import { relTime } from '../state'

interface Props {
  profileId: string
  width: number
  onPanel: (p: string | null) => void
  toast: (m: string, kind?: 'info' | 'error') => void
}

const blank = (id: string, conversationId: string): ChatMessage => ({
  id, conversationId, role: 'assistant', text: '', thinking: null,
  steps: [], citations: [], attachments: [], error: null,
  createdAt: new Date().toISOString()
})

export default function Sidebar({ profileId, width, onPanel, toast }: Props): JSX.Element {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [showList, setShowList] = useState(false)
  const [streamingId, setStreamingId] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<ContextRef[]>([])
  const [skill, setSkill] = useState<Skill | null>(null)
  const [focusToken, setFocusToken] = useState(0)
  const thread = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  const refreshConversations = useCallback(() => {
    void window.voyager.chat.conversations().then(setConversations)
  }, [])
  useEffect(refreshConversations, [refreshConversations])

  // Conversation ids are profile-owned. A profile switch starts a fresh view
  // instead of letting the next message continue the old profile's thread.
  useEffect(() => {
    setConversationId(null)
    setMessages([])
    setConversations([])
    setShowList(false)
    setStreamingId(null)
    setAttachments([])
    setSkill(null)
    refreshConversations()
  }, [profileId, refreshConversations])

  // Keep the view pinned to the bottom unless the user has scrolled up.
  useEffect(() => {
    const el = thread.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => window.voyager.chat.onEvent((e: StreamEvent) => {
    setMessages((prev) => {
      const next = [...prev]
      const idx = next.findIndex((m) => m.id === e.messageId)
      const patch = (fn: (m: ChatMessage) => ChatMessage): ChatMessage[] => {
        if (idx < 0) return next
        next[idx] = fn(next[idx])
        return next
      }
      switch (e.type) {
        case 'start':
          setConversationId(e.conversationId)
          setStreamingId(e.messageId)
          return idx < 0 ? [...next, blank(e.messageId, e.conversationId)] : next
        case 'thinking':
          return patch((m) => ({ ...m, thinking: (m.thinking ?? '') + e.delta }))
        case 'text':
          return patch((m) => ({ ...m, text: m.text + e.delta }))
        case 'step':
        case 'approval':
          return patch((m) => {
            const steps = [...m.steps]
            const i = steps.findIndex((s) => s.id === e.step.id)
            i < 0 ? steps.push(e.step) : (steps[i] = e.step)
            return { ...m, steps }
          })
        case 'citations':
          return patch((m) => {
            const seen = new Set(m.citations.map((c) => c.url))
            return { ...m, citations: [...m.citations, ...e.citations.filter((c) => !seen.has(c.url))] }
          })
        case 'done':
          setStreamingId(null)
          refreshConversations()
          return next
        case 'error':
          setStreamingId(null)
          return patch((m) => ({ ...m, error: e.message }))
      }
    })
  }), [refreshConversations])

  // Menu / context-menu asks arrive here.
  useEffect(() => window.voyager.onAsk(async ({ prompt, skill: slug }) => {
    let s: Skill | null = null
    if (slug) s = (await window.voyager.skills.list()).find((x) => x.slug === slug) ?? null
    send(prompt, s, [])
  }), [conversationId])

  useEffect(() => window.voyager.onFocus('composer', () => setFocusToken((t) => t + 1)), [])

  const send = (text: string, useSkill = skill, atts = attachments): void => {
    const id = `local-${Date.now()}`
    setMessages((m) => [...m, {
      id, conversationId: conversationId ?? '', role: 'user', text,
      thinking: null, steps: [], citations: [], attachments: atts,
      error: null, createdAt: new Date().toISOString()
    }])
    pinned.current = true
    void window.voyager.chat
      .send({ conversationId, text, attachments: atts, skillSlug: useSkill?.slug })
      .catch((err: Error) => toast(String(err.message ?? err), 'error'))
    setAttachments([])
    setSkill(null)
  }

  const open = async (id: string): Promise<void> => {
    setConversationId(id)
    setMessages(await window.voyager.chat.history(id))
    setShowList(false)
  }

  const newChat = (): void => {
    setConversationId(null)
    setMessages([])
    setShowList(false)
    setFocusToken((t) => t + 1)
  }

  return (
    <div className="sidebar" style={{ width }}>
      <div className="sidebar-head">
        <span className="title" style={{ display: 'flex', alignItems: 'center', gap: 7 }}><VoyagerMark />Voyager</span>
        <button className="agent-text-button" onClick={() => window.voyager.agents.open()}>Agents</button>
        <button className="iconbtn" title="Chat history" onClick={() => setShowList((s) => !s)}>≡</button>
        <button className="iconbtn" title="New chat" onClick={newChat}>+</button>
        <button className="iconbtn" title="Skills" onClick={() => onPanel('skills')}>✧</button>
        <button className="iconbtn" title={`Settings (${window.voyager.platform === 'darwin' ? '⌘,' : 'Ctrl+,'})`} onClick={() => onPanel('settings')}>⚙</button>
      </div>

      {showList ? (
        <div className="thread">
          {conversations.length === 0 && <div className="empty">No chats yet.</div>}
          {conversations.map((c) => (
            <div className="list-row" key={c.id}>
              <button className="main" style={{ textAlign: 'left', background: 'none' }}
                onClick={() => void open(c.id)}>
                <div className="t">{c.title}</div>
                <div className="s">{relTime(c.updatedAt)}</div>
              </button>
              <button className="iconbtn" title="Delete chat"
                onClick={async () => {
                  setConversations(await window.voyager.chat.remove(c.id))
                  if (c.id === conversationId) newChat()
                }}>×</button>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="thread"
          ref={thread}
          onScroll={(e) => {
            const el = e.currentTarget
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
          }}
        >
          {messages.length === 0 && (
            <div className="empty">
              Ask about the page you are on.<br />
              <span style={{ fontSize: 11 }}>@ to pull in a tab · / to run a skill</span>
            </div>
          )}
          {messages.map((m) => (
            <Message
              key={m.id}
              msg={m}
              streaming={m.id === streamingId}
              onApprove={(stepId, ok) => {
                window.voyager.chat.approve(stepId, ok)
                setMessages((prev) => prev.map((x) => ({
                  ...x,
                  steps: x.steps.map((s) => s.id === stepId
                    ? { ...s, status: ok ? 'running' : 'denied' } : s)
                })))
              }}
            />
          ))}
        </div>
      )}

      <Composer
        busy={!!streamingId}
        attachments={attachments}
        setAttachments={setAttachments}
        skill={skill}
        setSkill={setSkill}
        onSend={(t) => send(t)}
        onStop={() => streamingId && window.voyager.chat.stop(streamingId)}
        focusToken={focusToken}
      />
    </div>
  )
}
