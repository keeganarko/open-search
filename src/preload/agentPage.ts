import type { AgentSnapshot, AgentElement, AgentPageAction, AgentPrepared, AgentActionResult, AgentRecipeStep } from '../shared/agents'
import { ipcRenderer } from 'electron'
// Type-bound to the shared contract without a runtime import: sharing a module
// between sandboxed preload entries makes Rollup emit an unsupported require().
const recordedChannel: typeof import('../shared/ipc').IPC.agentRecorded = 'voyager:agent-recorded'

const uid = (): string => Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) => n.toString(16)).join('-')
const documentId = uid()
const refs = new Map<string, { element: HTMLElement; fingerprint: string }>()
let snapshotId = ''
const prepared = new Map<string, { action: AgentPageAction; element?: HTMLElement; fingerprint: string; value: string; url: string; until: number }>()
let recording = false
let recorded: AgentRecipeStep[] = []
let fieldNumber = 0
const sensitive = /password|passcode|one.?time|otp|secret|token|credit.?card|card.?number|cc-|cvc|cvv|security.?code|social.?security|ssn/i
const bounded = (s: string | null | undefined, n = 200): string => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
function privateField(el: HTMLElement): boolean {
  return sensitive.test([el.getAttribute('type'), el.getAttribute('name'), el.id,
    el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.getAttribute('placeholder')].join(' '))
}
function editable(el: HTMLElement): boolean {
  if (privateField(el) || el.getAttribute('aria-readonly') === 'true') return false
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled
  if (el instanceof HTMLInputElement) return !el.readOnly && !el.disabled && /^(text|search|email|url|tel)$/.test(el.type)
  return el.isContentEditable
}
const fieldValue = (el: HTMLElement): string => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : el.textContent ?? ''
function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  const style = getComputedStyle(el)
  return el.isConnected && r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    && !el.closest('[hidden],[inert],[aria-hidden="true"]')
}
function name(el: HTMLElement): string {
  const labels = (el as HTMLInputElement).labels
  return bounded(el.getAttribute('aria-label') || (labels ? Array.from(labels).map((l) => l.textContent).join(' ') : '')
    || el.getAttribute('placeholder') || (!editable(el) ? el.textContent : '') || el.getAttribute('title') || el.getAttribute('name'))
}
function role(el: HTMLElement): string {
  return el.getAttribute('role') || (editable(el) ? 'textbox' : el.tagName === 'A' ? 'link' : 'button')
}
function fingerprint(el: HTMLElement): string {
  return JSON.stringify([el.tagName, role(el), name(el), el.getAttribute('type'), el.getAttribute('href'),
    el.getAttribute('formaction'), el.getAttribute('target'), el.getAttribute('disabled'), el.getAttribute('aria-disabled'),
    el.closest('form')?.getAttribute('action'), el.closest('form')?.getAttribute('method'), privateField(el)])
}
function pageText(root: Node = document.body ?? document): string {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const parts: string[] = []
  let total = 0, visited = 0, node: Node | null
  while ((node = walk.nextNode()) && visited++ < 25_000 && total < 16_000) {
    const p = node.parentElement
    if (!p || p.closest('script,style,noscript,template,input,textarea,[contenteditable],[data-private]')
      || !visible(p) || privateField(p)) continue
    const text = bounded(node.textContent, 1500)
    if (text) { parts.push(text); total += text.length }
  }
  return parts.join('\n').slice(0, 16_000)
}
export function agentSnapshot(): AgentSnapshot {
  snapshotId = uid()
  refs.clear()
  const elements: AgentElement[] = []
  const candidates = document.querySelectorAll<HTMLElement>('button,a[href],input,textarea,[role="button"],[role="link"],[contenteditable="true"],[role="textbox"]')
  for (const el of Array.from(candidates).slice(0, 2000)) {
    if (elements.length >= 100) break
    if (!visible(el) || privateField(el) || (el instanceof HTMLInputElement && !editable(el))) continue
    if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') continue
    const label = name(el)
    if (!label) continue
    const ref = uid()
    refs.set(ref, { element: el, fingerprint: fingerprint(el) })
    elements.push({ ref, role: role(el), name: label, editable: editable(el) })
  }
  const tables = Array.from(document.querySelectorAll('table')).filter((t) => visible(t)).slice(0, 6).map((t) => {
    const rows = Array.from(t.rows).slice(0, 41).map((r) => Array.from(r.cells).slice(0, 12).map((c) => bounded(pageText(c), 300)))
    return { columns: rows.shift() ?? [], rows }
  })
  return { documentId, snapshotId, url: location.href, title: bounded(document.title), text: pageText(), elements, tables }
}
export function agentPrepare(payload: { documentId: string; snapshotId: string; action: AgentPageAction }): AgentPrepared | null {
  if (payload.documentId !== documentId || payload.snapshotId !== snapshotId || window !== window.top) return null
  const action = payload.action
  let el: HTMLElement | undefined
  if (action.kind !== 'scroll') {
    const entry = refs.get(action.ref ?? '')
    if (!entry || !visible(entry.element) || fingerprint(entry.element) !== entry.fingerprint || privateField(entry.element)) return null
    el = entry.element
    if (action.kind === 'fill' && (!editable(el) || typeof action.text !== 'string' || action.text.length > 4000)) return null
    if (action.kind === 'click' && el instanceof HTMLAnchorElement && (!/^https?:$/.test(new URL(el.href).protocol) || (el.target && el.target !== '_self'))) return null
  }
  if (action.expectedText && pageText().includes(action.expectedText)) return null
  const token = uid()
  // A tab admits only a few pending preparations; execution consumes its token.
  for (const [key, value] of prepared) if (value.until < Date.now()) prepared.delete(key)
  if (prepared.size >= 6) return null
  prepared.set(token, { action: { ...action }, element: el, fingerprint: el ? fingerprint(el) : '',
    value: el && editable(el) ? fieldValue(el) : '', url: location.href, until: Date.now() + 60_000 })
  return { token, documentId, description: action.kind === 'scroll' ? `Scroll ${action.direction ?? 'down'}`
    : `${action.kind === 'fill' ? 'Replace text in' : 'Click'} “${name(el!)}”`, ...(el instanceof HTMLAnchorElement ? { href: el.href } : {}) }
}
export async function agentAct(token: string): Promise<AgentActionResult> {
  const p = prepared.get(token)
  prepared.delete(token)
  if (!p || p.until < Date.now() || location.href !== p.url || window !== window.top) return { outcome: 'rejected', detail: 'The page or approval changed.' }
  const el = p.element
  if (el && (!visible(el) || fingerprint(el) !== p.fingerprint || privateField(el)
    || (editable(el) && fieldValue(el) !== p.value))) return { outcome: 'rejected', detail: 'The target changed. Inspect it again.' }
  if (p.action.kind === 'scroll') {
    const before = scrollY
    window.scrollBy({ top: (p.action.direction === 'up' ? -1 : 1) * innerHeight * 0.7, behavior: 'instant' })
    return { outcome: 'verified', detail: scrollY !== before ? 'The viewport moved. The site may load more content.' : 'The viewport is already at its limit.' }
  }
  if (p.action.kind === 'fill' && el) {
    if (!editable(el)) return { outcome: 'rejected', detail: 'This field can no longer be edited.' }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, p.action.text)
    } else el.textContent = p.action.text ?? ''
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: p.action.text }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 100))
    return { outcome: el.isConnected && fieldValue(el) === p.action.text ? 'verified' : 'unknown',
      detail: 'Checked the field value. The website may transmit or autosave it; no server-side receipt is available.' }
  }
  // Re-check immediately before dispatch. A click is sensitive regardless of its label.
  el?.click()
  await new Promise((resolve) => setTimeout(resolve, 350))
  const verified = !!p.action.expectedText && pageText().includes(p.action.expectedText)
  return { outcome: verified ? 'verified' : 'unknown', detail: verified
    ? `Observed the new expected page text: ${p.action.expectedText}` : 'Click dispatched; its outcome is unconfirmed. Check the page before another action.' }
}
function record(action: 'click' | 'fill', el: HTMLElement): void {
  if (!recording || recorded.length >= 24 || privateField(el) || !visible(el) || !name(el)) return
  const item: AgentRecipeStep = { origin: location.origin, role: role(el), name: name(el), action }
  if (action === 'fill') item.parameter = `field_${++fieldNumber}`
  const last = recorded.at(-1)
  if (last?.action === action && last.name === item.name && last.origin === item.origin) return
  recorded.push(item)
  ipcRenderer.send(recordedChannel, { documentId, step: item })
}
document.addEventListener('click', (e) => {
  if (!e.isTrusted || !(e.target instanceof Element)) return
  const el = e.target.closest<HTMLElement>('button,a[href],[role="button"],[role="link"]')
  if (el) record('click', el)
}, true)
document.addEventListener('change', (e) => {
  if (e.isTrusted && e.target instanceof HTMLElement && editable(e.target)) record('fill', e.target)
}, true)
document.addEventListener('input', (e) => {
  if (e.isTrusted && e.target instanceof HTMLElement && editable(e.target)) record('fill', e.target)
}, true)
export function agentStartRecording(): boolean { recorded = []; fieldNumber = 0; recording = true; return true }
export function agentRecording(): AgentRecipeStep[] { const steps = recorded; recorded = []; return steps }
export function agentStopRecording(): AgentRecipeStep[] { recording = false; return agentRecording() }
export function agentDiagnostics(): unknown {
  return { readyState: document.readyState, title: bounded(document.title), origin: location.origin,
    resources: performance.getEntriesByType('resource').slice(-40).map((entry) => {
      const e = entry as PerformanceResourceTiming
      let origin = ''; try { origin = new URL(e.name).origin } catch { /* opaque URL */ }
      return { origin, type: e.initiatorType, durationMs: Math.round(e.duration),
        transferBytes: e.transferSize, status: (e as PerformanceResourceTiming & { responseStatus?: number }).responseStatus ?? 0 }
    }) }
}
