import { randomUUID } from 'node:crypto'
import { listSkills, upsertSkill } from './db'
import type { Skill, SkillContext } from '@shared/types'

const ctx = (p: Partial<SkillContext>): SkillContext => ({
  currentPage: false, allTabs: false, selection: false,
  history: false, memory: true, connectors: false, ...p
})

type Seed = Omit<Skill, 'id' | 'builtin' | 'createdAt' | 'updatedAt'>

/** Dia ships Write, Code and a set of page actions; these are Open Search's equivalents. */
const SEEDS: Seed[] = [
  {
    slug: 'summary', name: 'Summarize', hotkey: 'CommandOrControl+Shift+S',
    description: 'Summarize the current page in a few tight bullets.',
    context: ctx({ currentPage: true }),
    model: null,
    prompt:
      'Summarize {{url}} for someone who has not read it.\n' +
      'Lead with the single most important claim in one sentence, then at most five bullets ' +
      'covering what is actually new or load-bearing. Skip navigation, boilerplate and marketing. ' +
      'If the page makes a claim that is contested or unsupported, say so.\n\n{{page}}'
  },
  {
    slug: 'write', name: 'Write', hotkey: null,
    description: 'Draft or rewrite text in your own voice.',
    context: ctx({ selection: true, currentPage: true }),
    model: null,
    prompt:
      'You are drafting on the user\'s behalf. Match the register and vocabulary of anything ' +
      'they have already written here — do not make it more formal or more enthusiastic than ' +
      'the surrounding text. No filler openers, no "I hope this finds you well".\n\n' +
      'Task: {{input}}\n\nExisting text (may be empty):\n{{selection}}'
  },
  {
    slug: 'code', name: 'Code', hotkey: null,
    description: 'Explain, debug or write code from the page or selection.',
    context: ctx({ selection: true, currentPage: true }),
    model: null,
    prompt:
      'Answer as an experienced engineer. Be concrete and short; show code rather than describing it. ' +
      'If the snippet has a bug, name the bug and the failing input before offering a fix.\n\n' +
      'Request: {{input}}\n\nCode:\n{{selection}}'
  },
  {
    slug: 'compare', name: 'Compare tabs', hotkey: null,
    description: 'Compare everything open across a table of real differences.',
    context: ctx({ allTabs: true }),
    model: null,
    prompt:
      'Compare the open tabs. Build a markdown table whose rows are the dimensions that actually ' +
      'differ between them — never a generic feature list. Below the table, state which one wins ' +
      'for which use case, and name anything the sources disagree about or leave out.\n\n{{tabs}}'
  },
  {
    slug: 'extract', name: 'Extract table', hotkey: null,
    description: 'Pull the structured data off this page into a table.',
    context: ctx({ currentPage: true }),
    model: null,
    prompt:
      'Extract the structured data on this page into one markdown table. Infer the columns from ' +
      'the data itself. Preserve units and exact figures — never round or reformat a number. ' +
      'If a cell is genuinely absent write "—" rather than guessing.\n\n{{page}}'
  },
  {
    slug: 'explain', name: 'Explain simply', hotkey: null,
    description: 'Explain the selection without dumbing it down.',
    context: ctx({ selection: true, currentPage: true }),
    model: null,
    prompt:
      'Explain this so a smart person outside the field gets it. Keep the real mechanism — ' +
      'simplify the vocabulary, not the content. Define jargon inline the first time. ' +
      'Roughly 150 words.\n\n{{selection}}'
  },
  {
    slug: 'video', name: 'Video digest', hotkey: null,
    description: 'Summarize a video with jump-to timestamps.',
    context: ctx({ currentPage: true }),
    model: null,
    prompt:
      'This is a video page; its transcript is below with timestamps. Produce a digest: a ' +
      'two-sentence overview, then the chapters as `[mm:ss] point` lines covering what is said, ' +
      'not what the title promises. Flag anywhere the video hedges or contradicts itself.\n\n{{page}}'
  },
  {
    slug: 'reply', name: 'Draft reply', hotkey: null,
    description: 'Draft a reply to the thread on screen.',
    context: ctx({ currentPage: true, selection: true }),
    model: null,
    prompt:
      'Draft a reply to the message or thread below. Match the sender\'s formality. Answer every ' +
      'question actually asked, in order. Keep it shorter than the message you are replying to. ' +
      'Output only the reply body — no subject line, no commentary.\n\n' +
      'Extra instruction: {{input}}\n\nThread:\n{{selection}}{{page}}'
  },
  {
    slug: 'fact-check', name: 'Fact-check', hotkey: null,
    description: 'Check this page\'s claims against the open web.',
    context: ctx({ currentPage: true, connectors: true }),
    model: null,
    prompt:
      'List the page\'s checkable factual claims. For each: search for corroboration, then mark it ' +
      'Supported / Disputed / Unverifiable with a source link and one line of evidence. ' +
      'Do not mark something Supported on the strength of the page itself.\n\n{{page}}'
  },
  {
    slug: 'shop', name: 'Price check', hotkey: null,
    description: 'Compare this product on price, specs and returns.',
    context: ctx({ currentPage: true, connectors: true }),
    model: null,
    prompt:
      'Identify the product on this page with its exact model number. Search for it elsewhere and ' +
      'compare current price, shipping, return window and warranty in a table. Note whether the ' +
      'listed price is a genuine discount from its recent baseline or a reset anchor.\n\n{{page}}'
  }
]

/** Idempotent: seeds missing built-ins without clobbering user edits. */
export function seedBuiltinSkills(): void {
  const existing = new Set(listSkills().map((s) => s.slug))
  const now = new Date().toISOString()
  for (const seed of SEEDS) {
    if (existing.has(seed.slug)) continue
    upsertSkill({ ...seed, id: randomUUID(), builtin: true, createdAt: now, updatedAt: now })
  }
}

export function resetBuiltinSkill(slug: string): void {
  const seed = SEEDS.find((s) => s.slug === slug)
  if (!seed) return
  const current = listSkills().find((s) => s.slug === slug)
  if (!current) return
  upsertSkill({ ...current, ...seed, builtin: true, updatedAt: new Date().toISOString() })
}
