import Anthropic from '@anthropic-ai/sdk'
import type { VoyagerWindow } from '../browser/window'
import { getSettings } from '../store/settings'
import { browserTools, serverTools } from './tools'
import { mcp } from './mcp'

/**
 * A compact, non-streaming tool loop for background work (briefs, decks) where
 * there is no chat surface to stream into. Approvals do not apply: this path is
 * given read-class tools only.
 */
export async function oneShot(
  win: VoyagerWindow,
  prompt: string,
  opts: { system: string; maxRounds?: number; useConnectors?: boolean; effortOverride?: string } = { system: '' }
): Promise<string> {
  const settings = getSettings()
  if (!settings.ai.apiKey) throw new Error('No Anthropic API key set.')
  const client = new Anthropic({ apiKey: settings.ai.apiKey, maxRetries: 2 })

  const local = browserTools(win).filter((t) => t.actionClass === 'read')
  const localByName = new Map(local.map((t) => [t.definition.name, t]))
  const connectors = opts.useConnectors
    ? mcp.anthropicTools().filter((t) => t.actionClass === 'read')
    : []

  const tools: Anthropic.ToolUnion[] = [
    ...local.map((t) => t.definition),
    ...connectors.map((t) => ({
      name: t.name, description: t.description, input_schema: t.input_schema
    }) as Anthropic.Tool),
    ...serverTools()
  ]

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }]
  let text = ''
  const max = opts.maxRounds ?? 12

  for (let i = 0; i < max; i++) {
    const res = await client.messages.create({
      model: settings.ai.model,
      max_tokens: 16000,
      system: [{ type: 'text', text: opts.system, cache_control: { type: 'ephemeral' } }],
      thinking: { type: 'adaptive' },
      output_config: { effort: (opts.effortOverride ?? settings.ai.effort) as any },
      tools,
      messages
    })

    if (res.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: res.content })
      continue
    }
    if (res.stop_reason === 'refusal') {
      throw new Error('The model declined this request.')
    }

    text = res.content.filter((b) => b.type === 'text').map((b) => (b as any).text).join('')

    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
    if (!uses.length) return text

    messages.push({ role: 'assistant', content: res.content })
    const results: Anthropic.ToolResultBlockParam[] = []
    for (const use of uses) {
      let out: string
      try {
        const tool = localByName.get(use.name)
        out = tool ? await tool.run(use.input) : await mcp.call(use.name, use.input)
      } catch (err) {
        out = `Error: ${err instanceof Error ? err.message : String(err)}`
      }
      results.push({ type: 'tool_result', tool_use_id: use.id, content: out })
    }
    messages.push({ role: 'user', content: results })
  }
  return text
}

/** Pull the last fenced JSON block (or the whole string) and parse it. */
export function parseJsonBlock<T>(text: string): T | null {
  const fences = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)]
  const candidates = fences.length ? fences.map((m) => m[1]) : [text]
  for (const c of candidates.reverse()) {
    try { return JSON.parse(c.trim()) as T } catch { /* try the next one */ }
  }
  // Last resort: the outermost brace-delimited span.
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) as T } catch { /* give up */ }
  }
  return null
}
