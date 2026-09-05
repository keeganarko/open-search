import { describe, it, expect } from 'vitest'
import { shortcutUrl } from '../src/shared/bookmarks'

describe('favorite addresses', () => {
  it('normalizes a typed website without turning it into a search', () => {
    expect(shortcutUrl(' youtube.com ')).toBe('https://youtube.com/')
    expect(shortcutUrl('https://EXAMPLE.COM/projects?q=one#notes')).toBe('https://example.com/projects?q=one#notes')
    expect(shortcutUrl('localhost:3000/work')).toBe('https://localhost:3000/work')
  })
  it('preserves an explicit HTTP address', () => {
    expect(shortcutUrl('http://example.com/')).toBe('http://example.com/')
  })
  it('refuses executable and local-file schemes and embedded credentials', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd',
      'voyager://new-tab', 'https://user:password@example.com/', 'https://token@example.com/']) {
      expect(() => shortcutUrl(value)).toThrow()
    }
  })
  it('rejects malformed and oversized input', () => {
    for (const value of ['', 'hello world', 'https://', 'https://exa\nmple.com', 'a'.repeat(8193), null]) {
      expect(() => shortcutUrl(value as string)).toThrow()
    }
  })
})
