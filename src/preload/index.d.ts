import type { KiaApi } from './chrome'

declare global {
  interface Window {
    kia: KiaApi
  }
}

export {}
