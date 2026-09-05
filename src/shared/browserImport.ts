/** Public import contract. Source paths and password values stay in main. */
export interface ChromeProfile {
  id: string
  name: string
  directory: string
  bookmarks: boolean
  history: boolean
}

export interface ImportCounts {
  bookmarks: number
  history: number
  passwords: number
  duplicates: number
  skipped: number
}

export interface ImportPreview {
  id: string
  source: string
  counts: ImportCounts
  warnings: string[]
}

export interface ChromeImportSelection {
  profileId: string
  bookmarks: boolean
  history: boolean
}

export type ImportFileKind = 'bookmarks' | 'passwords'
