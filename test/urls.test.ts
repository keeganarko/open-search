import { describe, it, expect } from 'vitest'
import {
  isAllowedPageUrl, looksLikeUrl, looksLikeQuestion, resolveInput, prettyHost, calendarEvent
} from '../src/main/browser/urls'

describe('looksLikeUrl', () => {
  it('accepts schemes, bare hosts and localhost', () => {
    for (const s of [
      'https://example.com', 'example.com', 'sub.example.co.uk/path?a=b',
      'localhost:5173', '127.0.0.1:8080', 'about:blank'
    ]) expect(looksLikeUrl(s), s).toBe(true)
  })

  it('rejects prose and single words', () => {
    for (const s of [
      '', '   ', 'how do i center a div', 'weather', 'best pizza near me'
    ]) expect(looksLikeUrl(s), s).toBe(false)
  })

  it('allows spaces in the query of a scheme-bearing URL', () => {
    // The whitespace guard only looks left of the `?`, so a pasted search URL
    // survives. A bare host with a spaced path does not — `BARE_HOST` still
    // rejects it, and searching for it is the better guess anyway.
    expect(looksLikeUrl('https://example.com/s?q=two words')).toBe(true)
    expect(looksLikeUrl('example.com/s?q=two words')).toBe(false)
  })
})

describe('looksLikeQuestion', () => {
  it('takes question marks, interrogatives and long phrases', () => {
    for (const s of ['is it down?', 'why is the sky blue', 'four words go here'])
      expect(looksLikeQuestion(s), s).toBe(true)
  })

  it('never treats a URL as a question', () => {
    expect(looksLikeQuestion('https://example.com/a/b/c/d/e?x=1')).toBe(false)
    expect(looksLikeQuestion('example.com')).toBe(false)
  })

  it('leaves short keyword searches alone', () => {
    expect(looksLikeQuestion('vitest config')).toBe(false)
  })
})

describe('resolveInput', () => {
  it('passes real URLs through untouched', () => {
    expect(resolveInput('https://example.com/x', 'google')).toBe('https://example.com/x')
  })

  it('upgrades a bare host to https', () => {
    expect(resolveInput('example.com', 'google')).toBe('https://example.com')
  })

  it('searches anything that is not a URL', () => {
    expect(resolveInput('how tall is everest', 'duckduckgo'))
      .toBe('https://duckduckgo.com/?q=how%20tall%20is%20everest')
  })

  it('refuses to navigate to script-bearing schemes', () => {
    // The URL bar must never be a javascript: execution path.
    for (const s of [
      'javascript:alert(1)', 'data:text/html,<script>x</script>', 'blob:abc',
      'file:///C:/Users/alice/secrets.txt', 'file:///Users/alice/secrets.txt'
    ]) {
      const out = resolveInput(s, 'google')
      expect(out.startsWith('https://www.google.com/search?q='), s).toBe(true)
    }
  })

  it('is blank-safe', () => {
    expect(resolveInput('   ', 'kagi')).toBe('about:blank')
  })
})

describe('isAllowedPageUrl', () => {
  it('allows only web, blank, and known internal destinations', () => {
    for (const url of [
      'https://example.com/path', 'http://localhost:3000', 'about:blank',
      'voyager://new-tab', 'voyager://error?url=https%3A%2F%2Fexample.com'
    ]) expect(isAllowedPageUrl(url), url).toBe(true)

    for (const url of [
      'file:///C:/Windows/System32/drivers/etc/hosts', 'javascript:alert(1)',
      'mailto:test@example.com', 'voyager://unknown'
    ]) expect(isAllowedPageUrl(url), url).toBe(false)
  })
})

describe('prettyHost', () => {
  it('drops the www', () => {
    expect(prettyHost('https://www.example.com/a')).toBe('example.com')
  })
  it('returns the input when it will not parse', () => {
    expect(prettyHost('not a url')).toBe('not a url')
  })
})

describe('calendarEvent', () => {
  it('recognises a Google Calendar event and strips the suffix', () => {
    const hit = calendarEvent('https://calendar.google.com/calendar/u/0/r/eventedit/abc', 'Standup - Google Calendar')
    expect(hit).toEqual({ title: 'Standup', source: 'Google Calendar' })
  })

  it('recognises meeting hosts', () => {
    expect(calendarEvent('https://meet.google.com/abc-defg-hij', 'Meet')?.source)
      .toBe('meet.google.com')
  })

  it('returns null for an ordinary page', () => {
    expect(calendarEvent('https://example.com', 'Example')).toBeNull()
    expect(calendarEvent('not a url', 'x')).toBeNull()
  })
})
