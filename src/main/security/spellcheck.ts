import type { Session } from 'electron'

let enabledForNewSessions = false

/** Electron's Hunspell service can fetch dictionaries even when checking is off.
 * Its download override is process-wide, matching Voyager's global privacy
 * setting. An inert data URL has no host, DNS lookup, credentials or network.
 * Apply it on session-created, before asynchronous dictionary initialization.
 */
export function configureSpellcheck(ses: Session, enabled = enabledForNewSessions): void {
  enabledForNewSessions = enabled
  ses.setSpellCheckerDictionaryDownloadURL(enabled
    ? 'https://redirector.gvt1.com/edgedl/chrome/dict/' : 'data:application/octet-stream,')
  ses.setSpellCheckerEnabled(enabled)
}
