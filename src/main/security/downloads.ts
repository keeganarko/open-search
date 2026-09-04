import { extname } from 'node:path'
import { open, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { matchesThreat } from './threats'

const exec = promisify(execFile)
const executableExtensions = new Set(('exe msi msp msix msixbundle appx appxbundle com scr pif cpl dll ocx sys drv '
  + 'bat cmd ps1 ps1xml psc1 vbs vbe js jse wsf wsh hta reg lnk url scf application appref-ms '
  + 'sh bash zsh fish command workflow app pkg dmg deb rpm appimage desktop run bin jar apk iso img vhd vhdx '
  + 'docm dotm xlsm xlam xltm pptm potm ppam ppsm sldm').split(' '))

export function downloadRisk(filename: string, urls: string[], mime = ''): string | null {
  if (!urls.length || urls.some((url) => { try {
    return new URL(url).protocol !== 'https:' || matchesThreat(url)
  } catch { return true } })) return 'Downloads require HTTPS and a source outside the known threat list.'
  if (/[\u0000-\u001f\u007f<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/.test(filename)
    || /[. ]$/.test(filename) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) {
    return 'This filename can conceal or change the saved file type.'
  }
  if (executableExtensions.has(extname(filename).slice(1).toLowerCase())
    || /(?:x-msdownload|x-ms-installer|x-executable|x-sharedlib|x-dosexec|java-archive|x-apple-diskimage)/i.test(mime)) {
    return 'Executable and installable downloads are blocked in this version of Voyager.'
  }
  return null
}

/** Check content too: an executable named invoice.pdf must never reach Downloads. */
export async function executableContent(path: string): Promise<boolean> {
  const handle = await open(path, 'r')
  try {
    const bytes = Buffer.alloc(512)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    const prefix = bytes.subarray(0, bytesRead)
    if (prefix[0] === 0x4d && prefix[1] === 0x5a) return true // PE/DOS
    if (prefix.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return true
    if (prefix.subarray(0, 2).toString() === '#!') return true
    if (prefix.length >= 4 && [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe]
      .includes(prefix.readUInt32BE(0))) return true // Mach-O / fat / Java
    return false
  } finally { await handle.close() }
}

/** Apply the platform's Internet provenance before moving into the user's folder. */
export async function markDownloadedFile(path: string): Promise<void> {
  if (process.platform === 'win32') {
    const marker = '[ZoneTransfer]\r\nZoneId=3\r\n'
    await writeFile(`${path}:Zone.Identifier`, marker)
    if (await readFile(`${path}:Zone.Identifier`, 'utf8') !== marker) throw new Error('Could not mark Internet origin.')
  } else if (process.platform === 'darwin') {
    const quarantine = `0083;${Math.floor(Date.now() / 1000).toString(16)};Voyager;`
    await exec('/usr/bin/xattr', ['-w', 'com.apple.quarantine', quarantine, path], { timeout: 5000 })
  }
}
