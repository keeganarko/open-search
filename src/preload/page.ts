import { contextBridge, ipcRenderer } from 'electron'
import { Readability, isProbablyReaderable } from '@mozilla/readability'

const MAX = 400_000

function visibleText(root: Element | Document = document): string {
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (/^(script|style|noscript|template|svg|nav|footer)$/i.test(parent.tagName)) {
        return NodeFilter.FILTER_REJECT
      }
      const style = getComputedStyle(parent)
      if (style.display === 'none' || style.visibility === 'hidden') return NodeFilter.FILTER_REJECT
      return (node.nodeValue ?? '').trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    }
  })
  const parts: string[] = []
  let n: Node | null
  let total = 0
  while ((n = walker.nextNode())) {
    const t = (n.nodeValue ?? '').replace(/\s+/g, ' ').trim()
    if (!t) continue
    parts.push(t)
    total += t.length
    if (total > MAX) break
  }
  return parts.join(' ')
}

/** Best-effort transcript scrape for the video sites that render one in the DOM. */
function transcript(): string | null {
  const host = location.hostname
  if (/(^|\.)youtube\.com$/.test(host)) {
    const segments = document.querySelectorAll('ytd-transcript-segment-renderer')
    if (segments.length) {
      const lines: string[] = []
      segments.forEach((seg) => {
        const t = seg.querySelector('.segment-timestamp')?.textContent?.trim() ?? ''
        const s = seg.querySelector('.segment-text')?.textContent?.trim() ?? ''
        if (s) lines.push(t ? `[${t}] ${s}` : s)
      })
      if (lines.length) return lines.join('\n').slice(0, MAX)
    }
    // The description often carries chapter markers when no transcript panel is open.
    const desc = document.querySelector('#description-inline-expander, #description')?.textContent?.trim()
    if (desc && /\d+:\d{2}/.test(desc)) return `Description with chapters:\n${desc.slice(0, 20_000)}`
    return null
  }
  const cues = document.querySelectorAll('[class*="transcript" i] li, [data-purpose*="transcript" i] p')
  if (cues.length > 4) {
    return Array.from(cues).map((c) => c.textContent?.trim()).filter(Boolean).join('\n').slice(0, MAX)
  }
  return null
}

function extract() {
  const url = location.href
  const title = document.title
  const tx = transcript()
  let text = ''
  let byline: string | null = null

  try {
    if (isProbablyReaderable(document)) {
      const clone = document.cloneNode(true) as Document
      const article = new Readability(clone, { charThreshold: 200 }).parse()
      if (article?.textContent) {
        text = article.textContent.replace(/\n{3,}/g, '\n\n').trim()
        byline = article.byline ?? null
      }
    }
  } catch { /* Readability is best-effort; fall through to raw text */ }

  if (text.length < 400) {
    const fallback = visibleText()
    if (fallback.length > text.length) text = fallback
  }

  return { url, title, byline, text: text.slice(0, MAX), transcript: tx }
}

function selection(): string {
  return (window.getSelection()?.toString() ?? '').trim().slice(0, 100_000)
}

/**
 * Writes into the focused editable field. Deliberately cannot submit anything —
 * it dispatches input events so frameworks notice, and stops there.
 */
function insertText(payload: { text: string; replace: boolean }): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false

  if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /text|search|email|url|tel/.test(el.type))) {
    const start = payload.replace ? (el.selectionStart ?? el.value.length) : (el.selectionEnd ?? el.value.length)
    const end = payload.replace ? (el.selectionEnd ?? el.value.length) : start
    const next = el.value.slice(0, start) + payload.text + el.value.slice(end)
    // Native setter so React's synthetic onChange fires.
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    setter ? setter.call(el, next) : (el.value = next)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    const caret = start + payload.text.length
    el.setSelectionRange(caret, caret)
    return true
  }

  if (el.isContentEditable) {
    const sel = window.getSelection()
    if (payload.replace && sel && sel.rangeCount) {
      sel.getRangeAt(0).deleteContents()
      sel.getRangeAt(0).insertNode(document.createTextNode(payload.text))
      sel.collapseToEnd()
    } else {
      el.append(document.createTextNode(payload.text))
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true }))
    return true
  }
  return false
}

function selectionRect(): { x: number; y: number; width: number; height: number } | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null
  const r = sel.getRangeAt(0).getBoundingClientRect()
  if (!r.width && !r.height) return null
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

// ——— login forms ——————————————————————————————————————————

/**
 * The username field is whatever text-ish input sits closest *before* the
 * password in document order. Sites label it a dozen ways — "email", "login",
 * "user_id" — and autocomplete hints are absent as often as they are wrong, so
 * position beats naming here.
 */
function usernameFor(pw: HTMLInputElement): HTMLInputElement | null {
  const scope = pw.form ?? document
  const inputs = Array.from(scope.querySelectorAll('input')) as HTMLInputElement[]
  const idx = inputs.indexOf(pw)
  const usable = (i: HTMLInputElement): boolean =>
    /^(text|email|tel)$/.test(i.type) && !i.disabled && i.offsetParent !== null
  for (let i = idx - 1; i >= 0; i--) if (usable(inputs[i])) return inputs[i]
  return inputs.find(usable) ?? null
}

function passwordFields(): HTMLInputElement[] {
  return (Array.from(document.querySelectorAll('input[type=password]')) as HTMLInputElement[])
    .filter((i) => !i.disabled)
}

/** Native setter, so a React-controlled field actually registers the value. */
function setValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter ? setter.call(el, value) : (el.value = value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

/**
 * Reports a credential the user just submitted. Two password fields on screen
 * means a sign-up or a change-password form, where the pair worth keeping is
 * ambiguous, so those are left alone.
 */
function captureSubmit(): void {
  const fields = passwordFields()
  if (fields.length !== 1) return
  const pw = fields[0]
  if (!pw.value) return
  const user = usernameFor(pw)
  if (!user?.value) return
  ipcRenderer.send('kia:login-submitted', {
    url: location.href, username: user.value, password: pw.value
  })
}

// `submit` does not fire for forms driven by a click handler and fetch(), which
// is most of them now, so a captured-phase click on a plausible submit control
// is the second net. Both are idempotent — main dedupes on the value itself.
document.addEventListener('submit', captureSubmit, true)
document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement | null)?.closest('button,input[type=submit],[role=button]')
  if (el) setTimeout(captureSubmit, 0)
}, true)
window.addEventListener('beforeunload', captureSubmit)

ipcRenderer.on('kia:login-fill', (_e, cred: { username: string; password: string }) => {
  const fields = passwordFields()
  if (!fields.length) return
  const pw = fields[0]
  const user = usernameFor(pw)
  if (user) setValue(user, cred.username)
  setValue(pw, cred.password)
})

contextBridge.exposeInMainWorld('__kia', {
  extract, selection, insertText, selectionRect,
  /** Whether a fillable login form is on screen right now. */
  hasLoginForm: () => passwordFields().length > 0,
  meta: () => ({ url: location.href, title: document.title })
})

// Tell the chrome when a selection appears, so the writing-tools affordance
// can be offered without polling the page.
let lastHadSelection = false
document.addEventListener('selectionchange', () => {
  const has = !!selection()
  if (has === lastHadSelection) return
  lastHadSelection = has
  ipcRenderer.sendToHost?.('kia:selection', has)
  ipcRenderer.send('kia:page-selection-changed', { url: location.href, hasSelection: has })
})
