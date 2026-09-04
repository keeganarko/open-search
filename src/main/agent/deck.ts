import { app, shell } from 'electron'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'
import type { VoyagerWindow } from '../browser/window'
import { uniqueDownloadPath } from '../browser/session'
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
  win: VoyagerWindow, instruction: string
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

const MAX_SLIDES = 10
const MAX_TEXT = 2_000

function xml(value: unknown, limit = MAX_TEXT): string {
  return String(value ?? '').slice(0, limit)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function replace(source: string, token: string, value: unknown, limit?: number): string {
  return source.split(token).join(xml(value, limit))
}

function removeShape(source: string, token: string): string {
  const at = source.indexOf(token)
  if (at < 0) return source
  const start = source.lastIndexOf('<p:sp>', at)
  const end = source.indexOf('</p:sp>', at)
  return start >= 0 && end >= 0
    ? source.slice(0, start) + source.slice(end + '</p:sp>'.length)
    : replace(source, token, '')
}

async function textPart(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path)
  if (!file) throw new Error(`The Voyager deck template is missing ${path}.`)
  return file.async('string')
}

async function trimTemplate(zip: JSZip, used: number): Promise<void> {
  let rels = await textPart(zip, 'ppt/_rels/presentation.xml.rels')
  const removedIds: string[] = []
  for (const match of rels.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const target = match[0].match(/Target="slides\/slide(\d+)\.xml"/)
    if (!target || Number(target[1]) <= used) continue
    const id = match[0].match(/Id="([^"]+)"/)?.[1]
    if (id) removedIds.push(id)
    rels = rels.replace(match[0], '')
  }
  zip.file('ppt/_rels/presentation.xml.rels', rels)

  let presentation = await textPart(zip, 'ppt/presentation.xml')
  for (const id of removedIds) {
    presentation = presentation.replace(
      new RegExp(`<p:sldId\\b[^>]*r:id="${id}"[^>]*/>`), ''
    )
  }
  zip.file('ppt/presentation.xml', presentation)

  let contentTypes = await textPart(zip, '[Content_Types].xml')
  for (let i = used + 1; i <= MAX_SLIDES + 1; i++) {
    zip.remove(`ppt/slides/slide${i}.xml`)
    zip.remove(`ppt/slides/_rels/slide${i}.xml.rels`)
    zip.remove(`ppt/notesSlides/notesSlide${i}.xml`)
    zip.remove(`ppt/notesSlides/_rels/notesSlide${i}.xml.rels`)
    contentTypes = contentTypes
      .replace(new RegExp(`<Override\\b[^>]*PartName="/ppt/slides/slide${i}\\.xml"[^>]*/>`), '')
      .replace(new RegExp(`<Override\\b[^>]*PartName="/ppt/notesSlides/notesSlide${i}\\.xml"[^>]*/>`), '')
  }
  zip.file('[Content_Types].xml', contentTypes)

  const appXmlPath = 'docProps/app.xml'
  let appXml = await textPart(zip, appXmlPath)
  appXml = appXml.replace(/<Slides>\d+<\/Slides>/, `<Slides>${used}</Slides>`)
  zip.file(appXmlPath, appXml)
}

export async function renderPptx(spec: DeckSpec): Promise<string> {
  const slides = Array.isArray(spec.slides) ? spec.slides.slice(0, MAX_SLIDES) : []
  if (!String(spec.title ?? '').trim() || !slides.length) throw new Error('The deck has no usable slides.')

  const template = join(app.getAppPath(), 'resources', 'voyager-deck-template.pptx')
  const zip = await JSZip.loadAsync(await readFile(template))
  const titlePath = 'ppt/slides/slide1.xml'
  let title = await textPart(zip, titlePath)
  title = replace(title, '_VOYAGER_TITLE_', spec.title, 300)
  title = spec.subtitle
    ? replace(title, '_VOYAGER_SUBTITLE_', spec.subtitle, 500)
    : removeShape(title, '_VOYAGER_SUBTITLE_')
  zip.file(titlePath, title)

  let titleNotes = await textPart(zip, 'ppt/notesSlides/notesSlide1.xml')
  titleNotes = replace(titleNotes, '_VOYAGER_NOTE_0_', '')
  zip.file('ppt/notesSlides/notesSlide1.xml', titleNotes)

  for (let index = 0; index < slides.length; index++) {
    const number = index + 1
    const slide = slides[index]
    const path = `ppt/slides/slide${number + 1}.xml`
    let body = await textPart(zip, path)
    body = replace(body, `_VOYAGER_HEADING_${number}_`, slide.heading, 300)
    const bullets = Array.isArray(slide.bullets) ? slide.bullets.slice(0, 5) : []
    for (let bullet = 1; bullet <= 5; bullet++) {
      const token = `_VOYAGER_BULLET_${number}_${bullet}_`
      body = bullet <= bullets.length
        ? replace(body, token, bullets[bullet - 1], 500)
        : removeShape(body, token)
    }
    body = slide.source
      ? replace(body, `_VOYAGER_SOURCE_${number}_`, slide.source, 1_000)
      : removeShape(body, `_VOYAGER_SOURCE_${number}_`)
    zip.file(path, body)

    const notesPath = `ppt/notesSlides/notesSlide${number + 1}.xml`
    let notes = await textPart(zip, notesPath)
    notes = replace(notes, `_VOYAGER_NOTE_${number}_`, slide.note ?? '', 5_000)
    zip.file(notesPath, notes)
  }

  await trimTemplate(zip, slides.length + 1)
  const corePath = 'docProps/core.xml'
  zip.file(corePath, replace(await textPart(zip, corePath), '_VOYAGER_TITLE_', spec.title, 300))

  const safe = String(spec.title).replace(/[^\w\s-]/g, '').trim()
    .replace(/\s+/g, '-').slice(0, 60) || 'Voyager-deck'
  const path = uniqueDownloadPath(app.getPath('downloads'), `${safe}.pptx`)
  const data = await zip.generateAsync({
    type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 }
  })
  await writeFile(path, data)
  return path
}

export async function generateReport(
  win: VoyagerWindow, instruction: string
): Promise<{ path: string; title: string }> {
  const prompt =
    `${instruction || 'Write a report from the tabs I have open.'}\n\n` +
    `Read what you need first. Then write the report in markdown: a one-paragraph ` +
    `summary, then the substance under headings, then an explicit "Open questions" ` +
    `section listing what the sources do not settle. Cite sources inline as links.`
  const markdown = await oneShot(win, prompt, { system: SYSTEM, maxRounds: 14 })
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim().slice(0, 200)
    || instruction.trim().split(/\r?\n/)[0].slice(0, 200)
    || 'Voyager report'
  const safe = title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60)
    || 'Voyager-report'
  const path = uniqueDownloadPath(app.getPath('downloads'), `${safe}.md`)
  await writeFile(path, markdown, 'utf8')
  return { path, title }
}

export function revealFile(path: string): void {
  shell.showItemInFolder(path)
}
