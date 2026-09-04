import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import JSZip from 'jszip'
import { renderPptx } from '../src/main/agent/deck'

let generated: string | null = null
afterEach(async () => {
  if (generated) await unlink(generated).catch(() => {})
  generated = null
})

describe('Voyager deck export', () => {
  it('renders a valid, trimmed presentation without unresolved template text', async () => {
    await mkdir('/tmp/voyager-test/downloads', { recursive: true })
    generated = await renderPptx({
      title: 'Voyager & security',
      subtitle: 'A <safe> deck',
      slides: [{
        heading: 'What changed',
        bullets: ['Sandboxed UI', 'Strict IPC'],
        note: 'Mention defense in depth.',
        source: 'https://example.com/?a=1&b=2'
      }]
    })

    expect(dirname(generated)).toBe('/tmp/voyager-test/downloads')
    const zip = await JSZip.loadAsync(await readFile(generated))
    const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    expect(slides).toHaveLength(2)
    const allXml = (await Promise.all(
      Object.keys(zip.files).filter((name) => name.endsWith('.xml'))
        .map((name) => zip.file(name)!.async('string'))
    )).join('\n')
    expect(allXml).toContain('Voyager &amp; security')
    expect(allXml).toContain('A &lt;safe&gt; deck')
    expect(allXml).toContain('Sandboxed UI')
    expect(allXml).toContain('Mention defense in depth.')
    expect(allXml).not.toContain('_VOYAGER_')
  })
})
