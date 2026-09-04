import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    define: {
      __SECURITY_TEST__: JSON.stringify(process.env.VOYAGER_SECURITY_TEST === '1'),
      __TEST_TLS__: process.env.VOYAGER_TEST_TLS ?? 'null'
    },
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } }
  },
  preload: {
    // Readability must be bundled: the page preload runs sandboxed and cannot
    // require out of node_modules at runtime.
    plugins: [externalizeDepsPlugin({ exclude: ['@mozilla/readability'] })],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: {
      rollupOptions: {
        input: {
          chrome: resolve('src/preload/chrome.ts'),
          page: resolve('src/preload/page.ts')
        },
        output: { entryFileNames: '[name].js' }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: { '@shared': resolve('src/shared'), '@renderer': resolve('src/renderer') }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          overlay: resolve('src/renderer/overlay.html')
        }
      }
    }
  }
})
