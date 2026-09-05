import { z } from 'zod'
import type { AgentDefinition, AgentStart } from '@shared/agents'

export const AGENT_LIMITS = { tabs: 6, steps: 24, activeRuns: 3, inputTokens: 120_000, outputTokens: 16_000, responseTokens: 2400, wallMs: 300_000, approvalMs: 60_000 }
const short = z.string().trim().min(1).max(200)
const step = z.object({
  origin: z.string().max(2048).refine((s) => { try { return agentOrigin(s) === s } catch { return false } }),
  role: short, name: short, action: z.enum(['click', 'fill']),
  parameter: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).optional(), expectedText: z.string().trim().min(2).max(200).optional()
}).strict().refine((s) => s.action !== 'fill' || !!s.parameter)
const definition = z.object({
  schemaVersion: z.literal(1), id: z.string().max(100), name: short,
  description: z.string().max(300),
  mode: z.enum(['research', 'workflow', 'lens', 'watch', 'teach', 'diagnose', 'guide']),
  instructions: z.string().trim().min(1).max(8000), steps: z.array(step).max(AGENT_LIMITS.steps), builtin: z.boolean()
}).strict().refine((d) => d.steps.length === 0 || d.mode === 'workflow', 'Only workflow agents may contain recorded actions.')
const start = z.object({
  definitionId: short, task: z.string().trim().max(8000),
  tabIds: z.array(short).min(1).max(AGENT_LIMITS.tabs),
  connectorTools: z.array(short).max(12),
  parameters: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), z.string().max(4000)),
  intervalSeconds: z.number().int().min(15).max(600)
}).strict()
export function parseDefinition(value: unknown): AgentDefinition {
  if (JSON.stringify(value).length > 48_000) throw new Error('Agent recipe is too large.')
  return definition.parse(value)
}
export function parseStart(value: unknown): AgentStart {
  if (JSON.stringify(value).length > 48_000) throw new Error('Agent request is too large.')
  const parsed = start.parse(value)
  if (new Set(parsed.tabIds).size !== parsed.tabIds.length) throw new Error('Choose each tab once.')
  if (Object.keys(parsed.parameters).length > 40) throw new Error('Too many recipe parameters.')
  return parsed
}
export function agentOrigin(input: string): string {
  const u = new URL(input)
  if (!['https:', 'http:'].includes(u.protocol) || !u.hostname || u.username || u.password) throw new Error('Agents require an HTTP or HTTPS page without URL credentials.')
  return u.origin
}
/** Queries/fragments are deliberately absent from model context and persisted sources. */
export function sourceUrl(input: string): string {
  try { const u = new URL(input); agentOrigin(input); return u.origin + u.pathname.replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]') } catch { return '' }
}
export function redact(text: string): string {
  return text.replace(/\b(Bearer\s+)[^\s"'<>]+/gi, '$1[redacted]')
    .replace(/\b((?:api[_-]?key|password|secret|token|authorization)\s*[:=]\s*)[^\s,;"'<>]+/gi, '$1[redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g, '[redacted]')
}
export function assertScope(profile: string, currentProfile: string, originalManager: unknown, currentManager: unknown, expired: boolean, paused: boolean): void {
  if (profile !== currentProfile || originalManager !== currentManager || expired || paused) throw new Error('Agent access expired, was paused, or the profile changed. Start a new run to continue.')
}
