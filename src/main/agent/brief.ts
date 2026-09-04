import { randomUUID } from 'node:crypto'
import type { VoyagerWindow } from '../browser/window'
import type { Brief, BriefSection } from '@shared/types'
import { getSettings } from '../store/settings'
import { oneShot, parseJsonBlock } from './oneshot'
import * as db from '../store/db'

const SYSTEM = `You are assembling the user's morning brief inside their browser.

Use the connectors and history tools available to you. Report only what you
actually found: if a connector returned nothing, say the section is empty rather
than inventing plausible entries. Never fabricate a meeting, a message, or a
sender. Times must be copied exactly from the source, never estimated.

Be terse. This is read in fifteen seconds over coffee.`

function todayKey(): string {
  return new Date().toLocaleDateString('en-CA') // YYYY-MM-DD in local time
}

export function existingBrief(profileId: string): Brief | null {
  return db.getBrief(profileId, todayKey())
}

export async function generateBrief(win: VoyagerWindow): Promise<Brief> {
  const settings = getSettings()
  const wanted: string[] = []
  if (settings.brief.includeTabs) wanted.push('what the user left open and was working on yesterday')
  if (settings.brief.includeReadingList) wanted.push('two or three things from their recent history worth finishing')

  const connectorNote = 'Background connector access is disabled. Calendar and mail sections must be empty. Only use the local browser tools available.'

  const prompt =
    `Assemble today's morning brief (${todayKey()}).\n\n${connectorNote}\n\n` +
    `Cover, in this order, only the sections that have real content:\n` +
    wanted.map((w) => `- ${w}`).join('\n') +
    `\n\nThen reply with ONLY a fenced JSON block in this shape:\n` +
    '```json\n' +
    `{"sections":[{"title":"Today","body":"one or two sentences of markdown",` +
    `"items":[{"label":"9:30 Standup","detail":"3 attendees","url":null,"at":"09:30"}]}]}\n` +
    '```\n' +
    `Every item's label must come from a tool result. An empty "sections" array is a valid answer.`

  const text = await oneShot(win, prompt, {
    system: SYSTEM, maxRounds: 14
  })

  const parsed = parseJsonBlock<{ sections: BriefSection[] }>(text)
  const sections: BriefSection[] = Array.isArray(parsed?.sections) && parsed!.sections.length
    ? parsed!.sections.map((s) => ({
        title: String(s.title ?? 'Brief'),
        body: String(s.body ?? ''),
        items: Array.isArray(s.items) ? s.items.map((i) => ({
          label: String(i.label ?? ''),
          detail: i.detail == null ? null : String(i.detail),
          url: i.url == null ? null : String(i.url),
          at: i.at == null ? null : String(i.at)
        })) : []
      }))
    // Model answered in prose — keep it rather than showing an empty brief.
    : [{ title: 'Brief', body: text.trim() || 'Nothing to report.', items: [] }]

  const brief: Brief = {
    id: randomUUID(),
    profileId: win.profile.id,
    date: todayKey(),
    sections,
    generatedAt: new Date().toISOString()
  }
  db.saveBrief(brief)
  return brief
}
