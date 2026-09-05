// Imported only by the dedicated test build; removed from normal distribution.
import { app, session, ipcMain } from 'electron'
import { IPC } from '@shared/ipc'
import { createServer as httpServer, type RequestListener } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { once } from 'node:events'
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { X509Certificate } from 'node:crypto'
import assert from 'node:assert/strict'
import * as db from '../store/db'
import { setSettings, getSettings, DEFAULT_SETTINGS } from '../store/settings'
import { initializeThreats, matchesThreat, threatStatus } from './threats'
import { callPage } from '../browser/pageBridge'
import { PageAgentRuntime, pageAgents } from '../agent/agentRuntime'
import type { AgentSnapshot, AgentPrepared, AgentStart, AgentActionResult } from '@shared/agents'
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
      if (_request.url?.startsWith('/agent-effect')) {
        _request.resume(); response.writeHead(200, { 'content-type': 'text/plain' }); response.end('Fixture effect received')
      } else if (_request.url === '/agent') {
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end(`<!doctype html><title>Agent fixture</title><h1>Agent workspace</h1>
          <label for="agent-title">Issue title</label><input id="agent-title" name="title" oninput="fetch('/agent-effect?fill', {method:'POST',body:this.value})">
          <input type="password" value="fixture-password-must-stay-private"><input autocomplete="cc-number" aria-label="Card number" value="fixture-card-private">
          <div id="agent-rich" role="textbox" aria-label="Message body" contenteditable="true" oninput="fetch('/agent-effect?rich', {method:'POST',body:this.textContent})">PRIVATE EDITOR VALUE</div>
          <div hidden>HIDDEN PRIVATE FIXTURE</div><table><tr><th>Name</th><th>Value</th></tr><tr><td>Example</td><td>42<span hidden>HIDDEN CELL FIXTURE</span></td></tr></table>
          <button id="preview" onclick="document.querySelector('#status').textContent='Draft ready'">Preview draft</button>
          <button id="unknown" onclick="fetch('/agent-effect?unknown', {method:'POST'})">Save remote</button><p id="status"></p>`)
      } else if (_request.url === '/download') {
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
    await run('Favorite bookmark IPC opens an existing tab and enforces profile ownership', async () => {
      const ui = win!.chrome.webContents
      const address = `http://localhost:${port}/permissions`
      const favorite = await ui.executeJavaScript(`window.voyager.bookmarks.addShortcut(${JSON.stringify(address)}, 'Fixture favorite', ${JSON.stringify(profile.id)})`)
      assert(db.getBookmark(profile.id, favorite.id)?.shortcut)
      const count = win!.tabs.list().length
      await ui.executeJavaScript(`window.voyager.bookmarks.open(${JSON.stringify(favorite.id)}, ${JSON.stringify(profile.id)})`)
      assert.equal(win!.tabs.list().length, count, 'Opening the same favorite must reuse the tab.')
      assert.equal(win!.tabs.activeId, tab.id)
      const other = db.addBookmark('fixture-other-profile', address, 'Other profile', null, true)
      await assert.rejects(ui.executeJavaScript(`window.voyager.bookmarks.setShortcut(${JSON.stringify(other.id)}, false, ${JSON.stringify(profile.id)})`))
      await assert.rejects(ui.executeJavaScript(`window.voyager.bookmarks.open(${JSON.stringify(other.id)}, ${JSON.stringify(profile.id)})`))
      assert(db.getBookmark('fixture-other-profile', other.id)?.shortcut)
      await ui.executeJavaScript(`window.voyager.bookmarks.setShortcut(${JSON.stringify(favorite.id)}, false, ${JSON.stringify(profile.id)})`)
      assert.equal(db.getBookmark(profile.id, favorite.id)?.shortcut, false, 'Removing a favorite preserves its bookmark.')
    })
    await wc.loadURL(`http://localhost:${port}/agent`)
    setSettings({ privacy: { ...getSettings().privacy, paused: false } })
    const agentInput = (definitionId: string): AgentStart => ({ definitionId, task: 'Fixture task', tabIds: [tab.id], connectorTools: [], parameters: {}, intervalSeconds: 15 })
    await run('Agent snapshots omit sensitive fields and hidden table text in the real preload', async () => {
      const s = await callPage<AgentSnapshot>(wc, 'agentSnapshot')
      assert(s)
      assert(s?.elements.some((e) => e.name === 'Issue title'))
      assert(!JSON.stringify(s).includes('fixture-password'))
      assert(!JSON.stringify(s).includes('fixture-card'))
      assert(!JSON.stringify(s).includes('HIDDEN'))
      assert(!JSON.stringify(s).includes('PRIVATE EDITOR VALUE'))
      assert(!s.elements.some((e) => e.name === 'Card number'))
      assert.deepEqual(await wc.executeJavaScript('[typeof window.voyager, typeof window.__voyagerPage]'), ['undefined', 'undefined'])
    })
    await run('Prepared agent actions reject DOM replacement before causing any website effect', async () => {
      const s = (await callPage<AgentSnapshot>(wc, 'agentSnapshot'))!
      const field = s.elements.find((e) => e.name === 'Issue title')!
      const p = (await callPage<AgentPrepared>(wc, 'agentPrepare', { documentId: s.documentId, snapshotId: s.snapshotId, action: { kind: 'fill', ref: field.ref, text: 'Must not be inserted' } }))!
      assert(p)
      await wc.executeJavaScript(`const field = document.querySelector('#agent-title'); field.replaceWith(field.cloneNode(true));`)
      const before = hits.filter((h) => h.includes('/agent-effect')).length
      assert.equal((await callPage<AgentActionResult>(wc, 'agentAct', p.token))?.outcome, 'rejected')
      await pause(100)
      assert.equal(hits.filter((h) => h.includes('/agent-effect')).length, before)
    })
    await run('Approved field edits execute once and observe real autosave traffic', async () => {
      const s = (await callPage<AgentSnapshot>(wc, 'agentSnapshot'))!
      const p = (await callPage<AgentPrepared>(wc, 'agentPrepare', { documentId: s.documentId, snapshotId: s.snapshotId,
        action: { kind: 'fill', ref: s.elements.find((e) => e.name === 'Issue title')!.ref, text: 'Fixture title' } }))!
      const before = hits.filter((h) => h.endsWith('/agent-effect?fill')).length
      assert.equal((await callPage<AgentActionResult>(wc, 'agentAct', p.token))?.outcome, 'verified')
      await until(() => hits.filter((h) => h.endsWith('/agent-effect?fill')).length === before + 1)
      assert.equal(await wc.executeJavaScript(`document.querySelector('#agent-title').value`), 'Fixture title')
      assert.equal((await callPage<AgentActionResult>(wc, 'agentAct', p.token))?.outcome, 'rejected')
      assert.equal(hits.filter((h) => h.endsWith('/agent-effect?fill')).length, before + 1)
      const richSnapshot = (await callPage<AgentSnapshot>(wc, 'agentSnapshot'))!
      const rich = (await callPage<AgentPrepared>(wc, 'agentPrepare', { documentId: richSnapshot.documentId, snapshotId: richSnapshot.snapshotId,
        action: { kind: 'fill', ref: richSnapshot.elements.find((e) => e.name === 'Message body')!.ref, text: 'Reviewed message body' } }))!
      assert.equal((await callPage<AgentActionResult>(wc, 'agentAct', rich.token))?.outcome, 'verified')
      assert.equal(await wc.executeJavaScript(`document.querySelector('#agent-rich').textContent`), 'Reviewed message body')
    })
    await run('Agent clicks distinguish verified UI transitions from unknown external outcomes', async () => {
      for (const [name, expectedText, outcome] of [['Preview draft', 'Draft ready', 'verified'], ['Save remote', undefined, 'unknown']] as const) {
        const s = (await callPage<AgentSnapshot>(wc, 'agentSnapshot'))!
        const p = (await callPage<AgentPrepared>(wc, 'agentPrepare', { documentId: s.documentId, snapshotId: s.snapshotId,
          action: { kind: 'click', ref: s.elements.find((e) => e.name === name)!.ref, expectedText } }))!
        assert.equal((await callPage<AgentActionResult>(wc, 'agentAct', p.token))?.outcome, outcome)
      }
    })
    await run('Packaged agent IPC scopes local watchers and rejects executable recipes', async () => {
      const ui = win!.chrome.webContents
      await assert.rejects(ui.executeJavaScript(`window.voyager.agents.save({schemaVersion:1,script:'untrusted'})`))
      await assert.rejects(ui.executeJavaScript(`window.voyager.agents.start(${JSON.stringify({ ...agentInput('watch'), tabIds: ['not-a-granted-tab'] })})`))
      const started = await ui.executeJavaScript(`window.voyager.agents.start(${JSON.stringify(agentInput('watch'))})`)
      assert.equal(started.status, 'watching')
      await ui.executeJavaScript(`window.voyager.agents.stop(${JSON.stringify(started.id)})`)
      assert.equal(pageAgents.state(win!).runs.find((r) => r.id === started.id)?.status, 'cancelled')
    })
    await run('Packaged agent broker refuses pending edits after a same-URL reload', async () => {
      // Reuse the broker's own inspected references when returning the model action.
      let lastRef = ''
      const scripted = new PageAgentRuntime(async (request) => {
        const result = request.messages.at(-1)?.content
        if (Array.isArray(result)) for (const block of result) {
          if (block.type === 'tool_result' && typeof block.content === 'string') {
            try { lastRef = JSON.parse(block.content).elements?.find((e: { name: string }) => e.name === 'Issue title')?.ref ?? lastRef } catch { /* non-snapshot result */ }
          }
        }
        return { inputTokens: 10, outputTokens: 10, content: [{ type: 'tool_use', caller: { type: 'direct' }, id: lastRef ? 'fixture-fill' : 'fixture-read',
          name: lastRef ? 'page_fill' : 'page_inspect', input: lastRef ? { tab_id: tab.id, ref: lastRef, text: 'Must not autosave' } : { tab_id: tab.id } }] }
      })
      try {
        const r = await scripted.start(win!, agentInput('workflow'))
        await until(() => !!scripted.state(win!).runs.find((x) => x.id === r.id)?.approval)
        const approval = scripted.state(win!).runs.find((x) => x.id === r.id)!.approval!
        const before = hits.filter((h) => h.includes('/agent-effect?fill')).length
        await wc.loadURL(`http://localhost:${port}/agent`)
        assert.throws(() => scripted.approve(win!, r.id, approval.id, true))
        await pause(100)
        assert.equal(hits.filter((h) => h.includes('/agent-effect?fill')).length, before)
      } finally { scripted.shutdown() }
    })
    await run('Trusted demonstrations omit field values and replay through exact action approvals', async () => {
      const ui = win!.chrome.webContents
      const r = await ui.executeJavaScript(`window.voyager.agents.start(${JSON.stringify(agentInput('teach'))})`)
      let stage = 'Recording startup'
      const events: unknown[] = []
      const observe = (event: Electron.IpcMainEvent, payload: { documentId?: string; step?: { name?: string } }) => events.push({ sender: event.sender.id, mainFrame: event.senderFrame === event.sender.mainFrame, documentId: payload?.documentId, name: payload?.step?.name })
      ipcMain.on(IPC.agentRecorded, observe)
      try {
        await until(() => pageAgents.state(win!).runs.find((x) => x.id === r.id)?.message.startsWith('Recording your') === true)
        // Chromium hit testing needs a mapped, focused view for trusted input.
        win!.endSplash(); win!.setPanelVisible(false); win!.closeOverlay(); win!.window.show(); win!.window.focus(); win!.tabs.activate(tab.id); win!.layout(); wc.focus()
        await pause(200)
        stage = 'Trusted input recording'
        for (const selector of ['#agent-title', '#preview']) {
          const rect = await wc.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
          wc.sendInputEvent({ type: 'mouseDown', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 })
          wc.sendInputEvent({ type: 'mouseUp', x: Math.round(rect.x), y: Math.round(rect.y), button: 'left', clickCount: 1 })
          await pause(100)
          if (selector === '#agent-title') await wc.insertText('Do not record this field value')
        }
        await until(() => (pageAgents.state(win!).runs.find((x) => x.id === r.id)?.recordedSteps.length ?? 0) === 2)
        await ui.executeJavaScript(`window.voyager.agents.stop(${JSON.stringify(r.id)})`)
        await ui.executeJavaScript(`window.voyager.agents.saveRecording(${JSON.stringify(r.id)}, 'Fixture recipe', {'1':'Draft ready'})`)
        const recipe = pageAgents.state(win!).definitions.find((d) => d.name === 'Fixture recipe')!
        assert.equal(recipe.steps[1].name, 'Preview draft')
        assert(!JSON.stringify(recipe).includes('Do not record this field value'))
        await wc.loadURL(`http://localhost:${port}/agent`)
        const replay = await ui.executeJavaScript(`window.voyager.agents.start(${JSON.stringify({ ...agentInput(recipe.id), parameters: { field_1: 'Reviewed replay value' } })})`)
        for (let action = 0; action < 2; action++) {
          stage = `Replay approval ${action + 1}`
          await until(() => !!pageAgents.state(win!).runs.find((x) => x.id === replay.id)?.approval)
          const approval = pageAgents.state(win!).runs.find((x) => x.id === replay.id)!.approval!
          await ui.executeJavaScript(`window.voyager.agents.approve(${JSON.stringify(replay.id)}, ${JSON.stringify(approval.id)}, true)`)
          await until(() => pageAgents.state(win!).runs.find((x) => x.id === replay.id)?.approval?.id !== approval.id)
        }
        stage = 'Replay completion'
        await until(() => pageAgents.state(win!).runs.find((x) => x.id === replay.id)?.status === 'completed')
        assert.equal(await wc.executeJavaScript(`document.querySelector('#agent-title').value`), 'Reviewed replay value')
      } catch (error) {
        const observed = { bounds: tab.view.getBounds(), attached: win!.window.contentView.children.includes(tab.view), overlay: win!.overlayMode, windowFocused: win!.window.isFocused(), visible: tab.view.getVisible(), page: await wc.executeJavaScript(`({focused:document.hasFocus(),active:document.activeElement?.id,status:document.querySelector('#status')?.textContent})`).catch(() => null) }
        throw new Error(`${stage}: ${String(error)}; events=${JSON.stringify(events)}; page=${JSON.stringify(observed)}; run=${JSON.stringify(pageAgents.state(win!).runs.find((x) => x.id === r.id)?.recordedSteps)}`)
      } finally { ipcMain.removeListener(IPC.agentRecorded, observe); pageAgents.stop(win!, r.id); win!.window.hide() }
    })
    setSettings({ privacy: { ...getSettings().privacy, paused: true } })
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
  const passed = results.length >= 23 && results.every((result) => result.passed)
  writeFileSync(report, JSON.stringify({ passed, versions: process.versions, platform: process.platform,
    isolatedProfile: app.getPath('userData'), fixtureRequests: hits, results,
    limitations: ['Automated tests, not an independent penetration test.',
      'No Windows Hello biometric/PIN interaction; results apply only to the recorded platform.',
      'Network log covers controlled local fixtures, not a real browsing packet capture.'] }, null, 2))
  return passed
}
