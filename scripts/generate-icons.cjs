// Render the canonical vector with the project's Electron/Chromium version.
// Run: node scripts/generate-icons.cjs (requires a graphical desktop).
const { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename], { stdio: 'inherit', env })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}

const { app, BrowserWindow } = require('electron')
const root = resolve(__dirname, '..')
const scratch = mkdtempSync(join(tmpdir(), 'voyager-icons-'))
app.setPath('userData', scratch)
app.disableHardwareAcceleration()
app.on('will-quit', () => rmSync(scratch, { recursive: true, force: true }))

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 1024, useContentSize: true, show: false,
    frame: false, transparent: true, backgroundColor: '#00000000',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  const svg = readFileSync(join(root, 'resources/voyager-mark.svg'), 'utf8')
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<style>html,body{margin:0;background:transparent}svg{display:block}</style>' + svg
  ))
  const frames = []
  mkdirSync(join(root, 'build'), { recursive: true })
  for (const size of [16, 20, 24, 32, 40, 48, 64, 128, 256, 1024]) {
    await win.webContents.executeJavaScript(`
      document.querySelector('svg').style.width = '${size}px';
      document.querySelector('svg').style.height = '${size}px';
      new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    `)
    const capture = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
    const png = capture.resize({ width: size, height: size }).toPNG()
    if (size === 1024) writeFileSync(join(root, 'build/icon.png'), png)
    else {
      frames.push({ size, png })
      if (size === 256) writeFileSync(join(root, 'resources/icon-256.png'), png)
    }
  }
  // ICO supports PNG frames. Each size is rendered directly from the vector.
  const header = Buffer.alloc(6 + 16 * frames.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)
  let offset = header.length
  frames.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i
    header[entry] = header[entry + 1] = size === 256 ? 0 : size
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  writeFileSync(join(root, 'build/icon.ico'), Buffer.concat([header, ...frames.map(f => f.png)]))
  console.log('Updated build/icon.png, build/icon.ico, and resources/icon-256.png')
  win.destroy()
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
