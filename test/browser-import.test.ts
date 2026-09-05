import { describe, it, expect } from 'vitest'
import { parseChromeBookmarks, parseBookmarksHtml, parsePasswordsCsv, chromeTime, importUrl } from '../src/main/browser/importParsers'

const stamp = (date: string) => ((BigInt(Date.parse(date)) + 11644473600000n) * 1000n).toString()
describe('Chrome import formats', () => {
  it('preserves nested bookmark folders, titles, and dates while rejecting executable URLs', () => {
    const result = parseChromeBookmarks(JSON.stringify({ roots: { bookmark_bar: { name: 'Bookmarks bar', children: [
      { type: 'folder', name: 'Research', children: [
        { type: 'url', name: 'A & B', url: 'https://example.com/research', date_added: stamp('2025-01-01') },
        { type: 'url', name: 'script', url: 'javascript:alert(1)' },
        { type: 'url', name: 'credentials', url: 'https://user:secret@example.com' }
      ] }
    ] } } }))
    expect(result).toEqual({ rows: [{ url: 'https://example.com/research', title: 'A & B', folder: 'Bookmarks bar / Research', createdAt: '2025-01-01T00:00:00.000Z' }], skipped: 2 })
  })
  it('handles exported HTML as inert text with folders and character references', () => {
    const result = parseBookmarksHtml(`<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>Work &amp; writing</H3><DL><p>
      <DT><A HREF="https://example.com/?a=1&amp;b=2" ADD_DATE="1735689600">Writing &#x1F680;</A>
      <DT><A HREF="javascript:alert(1)">no</A></DL><p><DT><A HREF='https://outside.example'>Outside</A></DL>`)
    expect(result.rows[0]).toMatchObject({ url: 'https://example.com/?a=1&b=2', title: 'Writing 🚀', folder: 'Work & writing' })
    expect(result.rows[1].folder).toBeNull()
    expect(result.skipped).toBe(1)
  })
  it('does not coerce missing schemes, credential URLs, or local paths into websites', () => {
    for (const url of ['example.com', 'file:///etc/passwd', 'data:text/html,x', 'chrome://settings', 'https://a:b@x.test', 'https://x.test/\nsecret']) expect(importUrl(url)).toBeNull()
    expect(importUrl('https://EXAMPLE.com')).toBe('https://example.com/')
  })
  it('converts Chrome microseconds without precision loss and rejects invalid dates', () => {
    expect(chromeTime(stamp('2025-01-01'))).toBe('2025-01-01T00:00:00.000Z')
    for (const value of [null, '', '0', '-10', '1e12', '99999999999999999999', {}]) expect(chromeTime(value)).toBeNull()
  })
  it('accepts BOM, reordered headers, CRLF, commas, escaped quotes, and multiline passwords', () => {
    const result = parsePasswordsCsv('\uFEFFpassword,url,username,name,note\r\n"p,a""ss\r\nword",https://example.com/login,user,Example,note\r\n')
    expect(result.rows).toEqual([{ origin: 'https://example.com', username: 'user', password: 'p,a"ss\r\nword' }])
  })
  it('skips insecure, malformed, blank, and Android credential records', () => {
    const result = parsePasswordsCsv('name,url,username,password\nX,http://remote.example,u,p\nX,android://hash@app,u,p\nX,https://example.com,,p\nX,https://example.com,u,p,extra\nX,https://example.com,u,p\n')
    expect(result.skipped).toBe(4)
    expect(result.rows).toHaveLength(1)
  })
  it('reports malformed input without echoing any secrets', () => {
    for (const csv of ['name,url,username,password\nX,https://x.test,u,"secret', 'url,username,password\nhttps://x.test,u,"secret"x', 'url,url,password\na,b,secret']) {
      expect(() => parsePasswordsCsv(csv)).toThrow()
      try { parsePasswordsCsv(csv) } catch (e) { expect(String(e)).not.toContain('secret') }
    }
    expect(() => parseChromeBookmarks('{bad')).toThrow(/valid Chrome/)
    expect(() => parseChromeBookmarks('{}')).toThrow(/folders/)
    expect(() => parseBookmarksHtml('<html>not bookmarks</html>')).toThrow(/exported/)
  })
  it('bounds file size and nesting before a large import can exhaust resources', () => {
    expect(() => parsePasswordsCsv('x'.repeat(32 * 1024 * 1024 + 1))).toThrow(/32 MB/)
    let nested: any = { type: 'url', url: 'https://example.com' }
    for (let i = 0; i < 102; i++) nested = { children: [nested], name: 'deep' }
    expect(() => parseChromeBookmarks(JSON.stringify({ roots: { other: nested } }))).toThrow(/nested/)
  })
})
