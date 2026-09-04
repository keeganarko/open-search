import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  // Electron 44 declares itself as a host runtime. Put the test aliases on the
  // Vitest layer as well so Vite never externalizes the real binary package.
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    alias: {
      electron: resolve(__dirname, 'test/stubs/electron.ts'),
      'better-sqlite3': resolve(__dirname, 'test/stubs/better-sqlite3.ts'),
      '@ghostery/adblocker-electron': resolve(__dirname, 'test/stubs/adblocker-electron.ts')
    }
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      // Both are unavailable outside a packaged Electron process; see the
      // comments in each stub for what they stand in for.
      electron: resolve(__dirname, 'test/stubs/electron.ts'),
      'better-sqlite3': resolve(__dirname, 'test/stubs/better-sqlite3.ts'),
      '@ghostery/adblocker-electron': resolve(__dirname, 'test/stubs/adblocker-electron.ts')
    }
  }
})
