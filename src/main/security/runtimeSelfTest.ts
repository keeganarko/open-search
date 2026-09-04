// Imported only by the dedicated test build; removed from normal distribution.
import { app, session } from 'electron'
import { createServer as httpServer, type RequestListener } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { once } from 'node:events'
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { X509Certificate } from 'node:crypto'
import assert from 'node:assert/strict'
import * as db from '../store/db'
import { setSettings, DEFAULT_SETTINGS } from '../store/settings'
import { initializeThreats, matchesThreat, threatStatus } from './threats'
import { callPage } from '../browser/pageBridge'
import { listDownloads, refreshSessionPrivacy } from '../browser/session'
import { type VoyagerWindow } from '../browser/window'
import { hasSecureStorage } from '../store/secureStorage'

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
async function until(predicate: () => boolean, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!predicate()) { if (Date.now() > end) throw new Error('Timed out waiting for browser behavior.'); await pause(40) }
}

export async function runRuntimeSecurityTests(createWindow: () => Promise<VoyagerWindow>): Promise<boolean> {
  const report = process.argv.find((a) => a.startsWith('--security-report='))?.slice('--security-report='.length)
    ?? join(app.getPath('userData'), 'runtime-results.json')
  mkdirSync(dirname(report), { recursive: true })
  const results: { name: string; passed: boolean; error?: string }[] = []
  const hits: string[] = []
  const run = async (name: string, work: () => unknown): Promise<void> => {
    try { await work(); results.push({ name, passed: true }) }
    catch (error) { results.push({ name, passed: false, error: String(error) }) }
  }
  const deadline = setTimeout(() => {
    writeFileSync(report, JSON.stringify({ passed: false, error: 'Packaged tests timed out.', results }, null, 2))
    app.exit(1)
  }, 120_000)
  let win: VoyagerWindow | undefined
  let logging: Electron.Session | undefined
  let http: ReturnType<typeof httpServer> | undefined
  let https: ReturnType<typeof httpsServer> | undefined
  try {
    assert(app.isPackaged, 'Tests must run in an actual packaged application.')
    assert(__TEST_TLS__, 'Missing temporary TLS test fixture.')
    await run('OS credential storage is available', () => assert(hasSecureStorage()))
    db.openDb()
    const profile = db.ensureDefaultProfile()
    setSettings({ privacy: { ...DEFAULT_SETTINGS.privacy, blockAds: false, blockTrackers: false, excludedDomains: [], paused: true },
      appearance: { ...DEFAULT_SETTINGS.appearance, startupStory: false, startupSound: false },
      brief: { ...DEFAULT_SETTINGS.brief, enabled: false } })
    await initializeThreats(false)
    const blockedHost = readFileSync(join(app.getAppPath(), 'resources/security/threat-domains.txt'), 'utf8')
      .split('\n').find((line) => line && !line.startsWith('#'))!.trim()
    const handler: RequestListener = (_request, response) => {
      hits.push(`${_request.headers.host}${_request.url}`)
      if (_request.url === '/download') {
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="report.txt"' })
        response.end('Harmless Voyager security fixture')
      } else if (_request.url === '/disguised') {
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="invoice.pdf"' })
        response.end(Buffer.from('MZ' + 'Harmless test bytes; not executable machine code'))
      } else if (_request.url === '/redirect-threat') {
        response.writeHead(302, { location: `http://${blockedHost}:${(http!.address() as any).port}/blocked-redirect` }); response.end()
      } else {
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end('<!doctype html><title>Voyager security fixture</title><p>Fixture readable content</p><input type="password"><input id="text">')
      }
    }
    http = httpServer(handler)
    https = httpsServer(__TEST_TLS__, handler)
    http.listen(0, '127.0.0.1'); https.listen(0, '127.0.0.1')
    await Promise.all([once(http, 'listening'), once(https, 'listening')])
    const port = (http.address() as any).port
    const tlsPort = (https.address() as any).port
    win = await createWindow()
    win.window.hide()
    const tab = win.tabs.create({ deferLoad: true })
    const wc = tab.view.webContents
    logging = wc.session
    const netlog = join(app.getPath('userData'), 'network.json')
    await logging.netLog.startLogging(netlog, { captureMode: 'default' })
    await wc.loadURL(`http://voyager-a.test:${port}/page`)
    await run('Page has sandbox, context isolation, web security and no Node integration', async () => {
      const prefs = (wc as Electron.WebContents & { getLastWebPreferences(): Electron.WebPreferences }).getLastWebPreferences()
      assert(prefs.sandbox && prefs.contextIsolation && prefs.webSecurity && !prefs.nodeIntegration)
      assert.deepEqual(await wc.executeJavaScript('[typeof require, typeof process, typeof window.voyager, typeof window.__voyagerPage]'),
        ['undefined', 'undefined', 'undefined', 'undefined'])
    })
    await run('Isolated preload bridge executes in the packaged sandbox', async () => {
      const result = await callPage(wc, 'meta')
      assert(result, 'The real sandboxed page preload did not load.')
    })
    await run('Privileged UI is sandboxed and its settings IPC works', async () => {
      const prefs = (win!.chrome.webContents as Electron.WebContents & { getLastWebPreferences(): Electron.WebPreferences }).getLastWebPreferences()
      assert(prefs.sandbox && prefs.contextIsolation && !prefs.nodeIntegration)
      assert(win!.trustsUiSender(win!.chrome.webContents))
      const settings = await win!.chrome.webContents.executeJavaScript('window.voyager.settings.get()')
      assert.equal(settings.ai.apiKey, null)
    })
    await run('Cross-site tabs use different renderer processes', async () => {
      const other = win!.tabs.create({ deferLoad: true })
      await other.view.webContents.loadURL(`http://voyager-b.test:${port}/other`)
      assert.notEqual(wc.getOSProcessId(), other.view.webContents.getOSProcessId())
      win!.tabs.close(other.id)
    })
    await run('Profiles isolate website cookies', async () => {
      await wc.session.cookies.set({ url: `http://voyager-a.test:${port}`, name: 'fixture', value: 'only-profile-one' })
      const other = session.fromPartition('persist:security-other-profile')
      assert.equal((await other.cookies.get({ name: 'fixture' })).length, 0)
    })
    await run('Untrusted TLS certificates are refused without sending HTTP content', async () => {
      await assert.rejects(wc.loadURL(`https://voyager-a.test:${tlsPort}/invalid-certificate`))
      assert(!hits.some((h) => h.endsWith('/invalid-certificate')))
    })
    await run('Known threat domains and redirects are blocked before reaching the server', async () => {
      assert(threatStatus().domains > 100_000 && matchesThreat(`http://${blockedHost}`))
      await wc.loadURL(`http://${blockedHost}:${port}/blocked-direct`).catch(() => {})
      await pause(150)
      await wc.loadURL(`http://voyager-a.test:${port}/redirect-threat`).catch(() => {})
      await pause(150)
      assert(!hits.some((h) => h.includes('/blocked-')))
      await refreshSessionPrivacy()
      await wc.loadURL(`http://${blockedHost}:${port}/blocked-after-ad-toggle`).catch(() => {})
      await pause(100)
      assert(!hits.some((h) => h.includes('/blocked-')))
    })
    await run('Cross-origin page script cannot read another site frame', async () => {
      await wc.loadURL(`http://voyager-a.test:${port}/page`)
      const denied = await wc.executeJavaScript(`new Promise(resolve => {
        const frame = document.createElement('iframe'); frame.src = 'http://voyager-b.test:${port}/frame';
        frame.onload = () => { try { void frame.contentWindow.document.body; resolve(false) } catch { resolve(true) } };
        document.body.append(frame);
      })`)
      assert.equal(denied, true)
    })
    await run('Privileged UI CSP prevents outbound requests', async () => {
      const denied = await win!.chrome.webContents.executeJavaScript(`fetch('http://voyager-a.test:${port}/ui-exfiltration').then(() => false, () => true)`)
      assert.equal(denied, true)
      assert(!hits.some((h) => h.includes('/ui-exfiltration')))
    })
    await run('HTTP downloads are blocked', async () => {
      wc.downloadURL(`http://voyager-a.test:${port}/download`)
      await until(() => listDownloads().some((d) => d.state === 'blocked'))
      assert(!listDownloads().some((d) => d.state === 'completed'))
    })
    // Trust only this ephemeral fixture certificate for the remaining download
    // tests. The normal release does not contain this code or this certificate.
    const fixtureCertificate = new X509Certificate(__TEST_TLS__.cert).raw
    wc.session.setCertificateVerifyProc((request, callback) => {
      try {
        const sameCertificate = new X509Certificate(request.certificate.data).raw.equals(fixtureCertificate)
        callback(request.hostname === 'voyager-download.test' && sameCertificate ? 0 : -3)
      } catch { callback(-3) }
    })
    await run('Executable bytes disguised as a document stay out of Downloads', async () => {
      wc.downloadURL(`https://voyager-download.test:${tlsPort}/disguised`)
      await until(() => listDownloads().some((d) => d.filename === 'invoice.pdf' && d.state === 'blocked'))
      assert(!listDownloads().some((d) => d.filename === 'invoice.pdf' && d.state === 'completed'))
    })
    await run('Safe HTTPS download is published with platform Internet-origin protections', async () => {
      wc.downloadURL(`https://voyager-download.test:${tlsPort}/download`)
      await until(() => listDownloads().some((d) => d.filename === 'report.txt' && d.state === 'completed'))
      const download = listDownloads().find((d) => d.state === 'completed')!
      assert.equal(readFileSync(download.path, 'utf8'), 'Harmless Voyager security fixture')
      if (process.platform === 'win32') assert.match(readFileSync(`${download.path}:Zone.Identifier`, 'utf8'), /ZoneId=3/)
    })
    wc.session.setCertificateVerifyProc(null)
    await run('Denied notifications remain denied in the real page', async () => {
      await wc.loadURL(`http://localhost:${port}/permissions`)
      db.recordPermission(profile.id, `http://localhost:${port}`, 'notifications', false)
      assert.equal(await wc.executeJavaScript('Notification.requestPermission()'), 'denied')
    })
    await logging.netLog.stopLogging()
    copyFileSync(netlog, join(dirname(report), 'runtime-network.json'))
    logging = undefined
    await run('Disabled spellchecking makes no dictionary download request', () => {
      assert(!readFileSync(netlog, 'utf8').includes('/edgedl/chrome/dict/'))
    })
  } catch (error) { results.push({ name: 'Packaged setup', passed: false, error: String(error) }) }
  finally {
    if (logging) await logging.netLog.stopLogging().catch(() => {})
    http?.close(); https?.close()
    clearTimeout(deadline)
  }
  const passed = results.length >= 15 && results.every((result) => result.passed)
  writeFileSync(report, JSON.stringify({ passed, versions: process.versions, platform: process.platform,
    isolatedProfile: app.getPath('userData'), fixtureRequests: hits, results,
    limitations: ['Automated tests, not an independent penetration test.',
      'No Windows Hello biometric/PIN interaction; results apply only to the recorded platform.',
      'Network log covers controlled local fixtures, not a real browsing packet capture.'] }, null, 2))
  return passed
}
