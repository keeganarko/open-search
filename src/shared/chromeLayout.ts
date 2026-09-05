/** Shared by Electron page bounds and the renderer; dimensions are CSS pixels. */
export const BROWSER_CHROME = { tabs: 40, toolbar: 48, bookmarks: 32 } as const
export function browserTop(bookmarksOpen: boolean): number {
  return BROWSER_CHROME.tabs + BROWSER_CHROME.toolbar + (bookmarksOpen ? BROWSER_CHROME.bookmarks : 0)
}
