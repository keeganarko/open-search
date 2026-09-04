import { describe, expect, it } from 'vitest'
import { uniqueDownloadPath } from '../src/main/browser/session'

describe('uniqueDownloadPath', () => {
  it('keeps an unused name', () => {
    expect(uniqueDownloadPath('/downloads', 'invoice.pdf', () => false))
      .toMatch(/[/\\]downloads[/\\]invoice\.pdf$/)
  })

  it('adds a Chrome-style suffix before the extension', () => {
    const occupied = new Set([
      '/downloads/invoice.pdf',
      '/downloads/invoice (1).pdf'
    ])
    expect(uniqueDownloadPath('/downloads', 'invoice.pdf', (p) => occupied.has(p)))
      .toMatch(/[/\\]downloads[/\\]invoice \(2\)\.pdf$/)
  })

  it('drops any directory supplied by a download filename', () => {
    expect(uniqueDownloadPath('/downloads', '../private/report.txt', () => false))
      .toMatch(/[/\\]downloads[/\\]report\.txt$/)
  })
})
