export const MAX_SHORTCUTS = 24

export const STARTER_SHORTCUTS = [
  { title: 'Gmail', url: 'https://mail.google.com/' },
  { title: 'YouTube', url: 'https://www.youtube.com/' }
] as const

/** Favorites open ordinary web pages; saving one never fetches the destination. */
export function shortcutUrl(input: string): string {
  if (typeof input !== 'string' || input.length > 8192) throw new Error('Enter a valid website address.')
  const value = input.trim()
  if (!value || /[\s\u0000-\u001f\u007f]/.test(value)) throw new Error('Enter a valid website address.')
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value)
  const hostWithPort = /^(?:localhost|[a-z\d.-]+\.[a-z\d.-]+):\d+(?:[/?#]|$)/i.test(value)
  let url: URL
  try { url = new URL(hasScheme && !hostWithPort ? value : `https://${value}`) }
  catch { throw new Error('Enter a valid website address.') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('Use an HTTP or HTTPS address without a username or password.')
  }
  return url.href
}
