import { dialog } from 'electron'
import type { VoyagerWindow } from '../browser/window'
import { getSettings } from '../store/settings'

/** Obtain consent before collecting or sending context for an interactive AI task. */
export async function authorizeContext(win: VoyagerWindow): Promise<void> {
  if (getSettings().ai.contextConsent) return
  const profileId = win.profile.id
  const result = await dialog.showMessageBox(win.window, {
    type: 'question', title: 'Share context with Anthropic?',
    message: 'Allow Voyager to use browser context for this AI task?',
    detail: 'Your request, allowed page text, tab titles, history, saved memory, and conversation may be sent to Anthropic. Excluded sites and paused page access remain blocked. Connector calls require separate approval.',
    buttons: ['Cancel', 'Allow this task'], defaultId: 0, cancelId: 0, noLink: true
  })
  if (result.response !== 1 || win.profile.id !== profileId || win.window.isDestroyed()) {
    throw new Error('Browser context was not shared. You can allow this task or change Settings → AI.')
  }
}
