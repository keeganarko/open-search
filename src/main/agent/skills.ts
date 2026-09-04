import type { VoyagerWindow } from '../browser/window'
import type { Skill, ContextRef } from '@shared/types'
import { escapeContextText, readTab, readSelection, renderPage } from './context'
import * as db from '../store/db'

export interface ExpandedSkill {
  prompt: string
  attachments: ContextRef[]
}

/**
 * Fills a skill's template. Placeholders that the skill did not opt into are
 * replaced with empty strings rather than left as literal braces.
 */
export async function expandSkill(
  win: VoyagerWindow, skill: Skill, userInput: string
): Promise<ExpandedSkill> {
  const active = win.tabs.active()
  const attachments: ContextRef[] = []

  let page = ''
  let url = active?.state.url ?? ''
  if (skill.context.currentPage && active) {
    const content = await readTab(win, active.id)
    if (content) {
      page = renderPage(content)
      url = content.url
      attachments.push({
        type: 'tab', id: active.id,
        label: content.title, detail: content.url
      })
    }
  }

  let selection = ''
  if (skill.context.selection) {
    selection = await readSelection(win)
  }

  let tabs = ''
  if (skill.context.allTabs) {
    const blocks: string[] = []
    const list = win.tabs.list()
    const budget = Math.max(6000, Math.floor(200_000 / Math.max(1, list.length)))
    for (const t of list) {
      const content = await readTab(win, t.id, budget)
      if (content) blocks.push(renderPage(content))
    }
    tabs = blocks.join('\n\n')
  }

  if (skill.context.history) {
    attachments.push({ type: 'history', id: 'history', label: 'Recent history', detail: 'last 7 days' })
  }

  const prompt = skill.prompt
    .replaceAll('{{selection}}', selection
      ? `<selection>\n${escapeContextText(selection)}\n</selection>`
      : '')
    .replaceAll('{{page}}', page)
    .replaceAll('{{tabs}}', tabs)
    .replaceAll('{{input}}', userInput)
    .replaceAll('{{url}}', escapeContextText(url))
    .trim()

  return { prompt, attachments }
}

export function findSkill(slug: string): Skill | undefined {
  return db.listSkills().find((s) => s.slug === slug)
}

/** Slash-command matches for the composer, ranked by prefix then substring. */
export function matchSkills(query: string): Skill[] {
  const q = query.toLowerCase().replace(/^\//, '')
  const all = db.listSkills()
  if (!q) return all
  const starts = all.filter((s) => s.slug.startsWith(q) || s.name.toLowerCase().startsWith(q))
  const contains = all.filter(
    (s) => !starts.includes(s) &&
      (s.slug.includes(q) || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
  )
  return [...starts, ...contains]
}
