import { app, shell } from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import PptxGenJS from 'pptxgenjs'
import type { KiaWindow } from '../browser/window'
import { oneShot, parseJsonBlock } from './oneshot'

export interface DeckSpec {
  title: string
  subtitle?: string
  slides: { heading: string; bullets: string[]; note?: string; source?: string }[]
}

const SYSTEM = `You turn what the user is looking at into a presentable deck.

Every bullet must be traceable to something you actually read. Do not pad a
slide to reach a bullet count — three real points beat six invented ones. Keep
bullets to one line each; the speaker fills in the rest. Where a slide rests on
one source, name it.`

export async function generateDeck(
  win: KiaWindow, instruction: string
): Promise<{ spec: DeckSpec; pptxPath: string }> {
  const prompt =
    `${instruction || 'Build a deck from the tabs I have open.'}\n\n` +
    `Read what you need with list_tabs and read_tab first. Then reply with ONLY a ` +
    `fenced JSON block:\n` +
    '```json\n' +
    `{"title":"...","subtitle":"...","slides":[{"heading":"...","bullets":["...","..."],` +
    `"note":"speaker note","source":"https://..."}]}\n` +
    '```\n' +
    `Six to ten slides. No slide may have more than five bullets.`

  const text = await oneShot(win, prompt, { system: SYSTEM, maxRounds: 12 })
  const spec = parseJsonBlock<DeckSpec>(text)
  if (!spec?.slides?.length) throw new Error('Could not build a deck from that — the model did not return slides.')

  const pptxPath = await renderPptx(spec)
  return { spec, pptxPath }
}

const INK = '1A1A1E'
const MUTED = '6B6B76'
const ACCENT = '6366F1'

export async function renderPptx(spec: DeckSpec): Promise<string> {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  pptx.title = spec.title

  const title = pptx.addSlide()
  title.background = { color: 'FFFFFF' }
  title.addText(spec.title, {
    x: 0.6, y: 2.0, w: 8.8, h: 1.2, fontSize: 40, bold: true, color: INK
  })
  if (spec.subtitle) {
    title.addText(spec.subtitle, {
      x: 0.6, y: 3.2, w: 8.8, h: 0.6, fontSize: 18, color: MUTED
    })
  }
  title.addShape(pptx.ShapeType.rect, {
    x: 0.6, y: 1.7, w: 1.2, h: 0.06, fill: { color: ACCENT }
  })

  for (const slide of spec.slides) {
    const s = pptx.addSlide()
    s.background = { color: 'FFFFFF' }
    s.addText(slide.heading, {
      x: 0.6, y: 0.5, w: 8.8, h: 0.8, fontSize: 26, bold: true, color: INK
    })
    const bullets = (slide.bullets ?? []).slice(0, 5)
    if (bullets.length) {
      s.addText(
        bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        { x: 0.7, y: 1.5, w: 8.6, h: 3.4, fontSize: 16, color: INK, lineSpacingMultiple: 1.3 }
      )
    }
    if (slide.source) {
      s.addText(slide.source, {
        x: 0.6, y: 5.0, w: 8.8, h: 0.3, fontSize: 10, color: MUTED
      })
    }
    if (slide.note) s.addNotes(slide.note)
  }

  const safe = spec.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'kia-deck'
  const path = join(app.getPath('downloads'), `${safe}.pptx`)
  const data = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
  await writeFile(path, data)
  return path
}

export async function generateReport(win: KiaWindow, instruction: string): Promise<string> {
  const prompt =
    `${instruction || 'Write a report from the tabs I have open.'}\n\n` +
    `Read what you need first. Then write the report in markdown: a one-paragraph ` +
    `summary, then the substance under headings, then an explicit "Open questions" ` +
    `section listing what the sources do not settle. Cite sources inline as links.`
  return oneShot(win, prompt, { system: SYSTEM, maxRounds: 14 })
}

export function revealFile(path: string): void {
  shell.showItemInFolder(path)
}
