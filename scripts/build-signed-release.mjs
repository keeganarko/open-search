import { build } from 'electron-builder'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { verifyArchive } from './verify-asar.mjs'

const check = spawnSync(process.execPath, ['scripts/verify-release-config.mjs'], { stdio: 'inherit' })
if (check.status !== 0) throw new Error('Release configuration is incomplete.')
const config = { directories: { output: 'release/signed' } }
if (process.platform === 'win32') {
  if (!process.env.CSC_LINK || !process.env.CSC_KEY_PASSWORD || !existsSync('resources/native/voyager-auth.exe')) {
    throw new Error('Windows signing credentials and the authentication helper are required.')
  }
  Object.assign(config, { forceCodeSigning: true, win: {
    signtoolOptions: { publisherName: [process.env.WIN_PUBLISHER_NAME] }, verifyUpdateCodeSignature: true,
    signExts: ['.exe']
  } })
} else if (process.platform === 'darwin') {
  for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']) {
    if (!process.env[key]) throw new Error(`${key} is required for signing and notarization.`)
  }
  Object.assign(config, { forceCodeSigning: true, mac: { hardenedRuntime: true, notarize: true } })
}
const result = spawnSync(process.execPath, ['node_modules/electron-vite/bin/electron-vite.js', 'build'], {
  stdio: 'inherit', env: { ...process.env, VOYAGER_SECURITY_TEST: '', VOYAGER_TEST_TLS: '' }
})
if (result.status !== 0) throw new Error('Build failed.')
await build({ publish: 'never', config, ...(process.platform === 'darwin' ? { mac: ['dmg', 'zip'], arm64: true }
  : process.platform === 'win32' ? { win: ['nsis'], x64: true } : { linux: ['AppImage'], x64: true }) })
verifyArchive(process.platform === 'darwin' ? 'release/signed/mac-arm64/Voyager.app/Contents/Resources/app.asar'
  : process.platform === 'win32' ? 'release/signed/win-unpacked/resources/app.asar'
    : 'release/signed/linux-unpacked/resources/app.asar')
