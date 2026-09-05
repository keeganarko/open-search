import { useEffect, useState } from 'react'
import type { AgentsState } from '@shared/agents'

export const activeAgent = (status: string): boolean => ['running', 'watching', 'recording', 'awaiting_approval'].includes(status)
export function useAgents(profileId: string) {
  const [state, setState] = useState<AgentsState>({ definitions: [], runs: [], windowKey: '', connectorTools: [] })
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    setState({ definitions: [], runs: [], windowKey: '', connectorTools: [] }); setError('')
    void window.voyager.agents.state().then((s) => { if (alive) setState(s) }).catch((e) => { if (alive) setError(String(e.message ?? e)) })
    const off = window.voyager.agents.onChanged((s) => { if (alive) setState(s) })
    return () => { alive = false; off() }
  }, [profileId])
  return { state, setState, error, setError }
}
export function AgentIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" />
    <rect x="3" y="14" width="7" height="7" rx="2" /><path d="M17.5 13v9M13 17.5h9" />
  </svg>
}
export default function AgentLauncher({ profileId }: { profileId: string }) {
  const { state } = useAgents(profileId)
  const active = state.runs.filter((r) => r.windowKey === state.windowKey && activeAgent(r.status))
  const review = active.some((r) => r.status === 'awaiting_approval')
  return <button className={`agent-launcher${review ? ' needs-review' : ''}`} onClick={() => window.voyager.agents.open()}
    title={`Open Agents (${window.voyager.platform === 'darwin' ? '⌘' : 'Ctrl+'}Shift+A)`} aria-label={`Agents${review ? ' · action needs review' : active.length ? ` · ${active.length} active` : ''}`}>
    <AgentIcon /><span>Agents</span>{active.length > 0 && <span className="agent-count">{review ? 'Review' : active.length}</span>}
  </button>
}
