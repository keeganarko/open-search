import { randomUUID } from 'node:crypto'
import { AGENT_PRESETS, type AgentDefinition, type AgentRun } from '@shared/agents'
import { kvGet, kvSet } from '../store/db'
import { parseDefinition } from './agentPolicy'

export function agentDefinitions(profileId: string): AgentDefinition[] {
  return [...AGENT_PRESETS, ...kvGet<AgentDefinition[]>(`agents:definitions:${profileId}`, [])]
}
export function saveAgentDefinition(profileId: string, input: unknown): AgentDefinition {
  const d = parseDefinition(input)
  const saved = kvGet<AgentDefinition[]>(`agents:definitions:${profileId}`, [])
  const existing = saved.findIndex((item) => item.id === d.id)
  const item = { ...d, id: existing < 0 ? randomUUID() : saved[existing].id, builtin: false }
  if (existing < 0 && saved.length >= 30) throw new Error('You can save up to 30 custom agents per profile.')
  existing < 0 ? saved.push(item) : saved.splice(existing, 1, item)
  kvSet(`agents:definitions:${profileId}`, saved)
  return item
}
export function deleteAgentDefinition(profileId: string, id: string): void {
  kvSet(`agents:definitions:${profileId}`, kvGet<AgentDefinition[]>(`agents:definitions:${profileId}`, []).filter((d) => d.id !== id))
}
export function agentHistory(profileId: string): AgentRun[] {
  return kvGet<AgentRun[]>(`agents:runs:${profileId}`, []).map((r) => ({ ...r, approval: null,
    ...(['running', 'watching', 'recording', 'awaiting_approval'].includes(r.status)
      ? { status: 'paused' as const, message: 'This run is no longer active. Start again with a fresh tab selection.' } : {}) }))
}
export function saveAgentRun(run: AgentRun): void {
  const runs = kvGet<AgentRun[]>(`agents:runs:${run.profileId}`, []).filter((r) => r.id !== run.id)
  // Approval capabilities and raw action inputs never persist. Keep only 20 runs.
  kvSet(`agents:runs:${run.profileId}`, [{ ...run, approval: null }, ...runs].slice(0, 20))
}
export function forgetAgentRun(profileId: string, id: string): void {
  kvSet(`agents:runs:${profileId}`, kvGet<AgentRun[]>(`agents:runs:${profileId}`, []).filter((r) => r.id !== id))
}
