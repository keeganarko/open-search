import type { VoyagerApi } from './chrome'

declare global {
  interface Window {
    voyager: VoyagerApi
  }
}

export {}
