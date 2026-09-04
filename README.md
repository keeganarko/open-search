# Open Search

A local, AI-native browser. Dia-shaped, and yours — the model is Claude, the key
is yours, and everything it learns stays on this machine.

## Run it

```bash
npm install
npm run dev
```

Then **Settings → AI** and paste an Anthropic API key. It goes into the macOS
keychain via `safeStorage`, never into the settings file and never into a sync
bundle.

```bash
npm run typecheck   # tsc over main+preload and renderer
npm test            # vitest over the pure logic — urls, policy, crypto, permissions
npm run build       # electron-vite build
npm run dist        # a signed-if-you-have-certs .dmg
npm run dist:win    # an NSIS installer
npm run dist:linux  # an AppImage
```

The `.dmg` is ad-hoc signed, which is all macOS needs to *run* it. Copy the app
out of the image and launch it. On a machine that downloaded the image rather
than built it, clear the quarantine flag once:
`xattr -dr com.apple.quarantine "/Applications/Open Search.app"`.

### On Windows

```powershell
git clone https://github.com/keeganarko/open-search.git
cd open-search
npm install
npm run dev
```

`better-sqlite3` ships N-API prebuilds, so nothing compiles and no Visual Studio
build tools are needed. Everything else is platform-agnostic except the window
chrome: macOS gets `hiddenInset` and the traffic lights, Windows and Linux get
`titleBarOverlay` with the system minimise/maximise/close drawn into the tab
strip, and the application menu that lives under **Open Search** on the Mac
collapses into **File** everywhere else. `<html data-platform>` carries the
platform to CSS, which is what reserves the right-hand gutter for those buttons.

Each machine keeps its own profile — the database, the cookies and the API key
never leave it. To carry skills, memory, bookmarks and connectors across, use
**Settings → Sync**: it writes one passphrase-encrypted file you can drop in
any shared folder. It deliberately does not carry the key or the sync settings
themselves.

Shortcuts are the same with Ctrl where the Mac uses ⌘.

## The opening

The first window of a launch opens with a five-second scribble animatic — a
storyboard that hard-cuts about six times a second, drawn as jittered polylines
that are re-jittered every frame so the ink "boils" like hand-inked animation.
Underneath it plays twelve seconds of the *Big Buck Bunny* theme, which then
crossfades into the same phrase an octave down, filtered dark and reverbed into
a seamless thirteen-second loop. The bed fades out the moment you click, type,
or scroll — and after two and a half minutes regardless.

Both are off switches in Settings → Appearance, with a volume for the sound.
The audio is derived from the Big Buck Bunny theme © Blender Foundation, used
under CC BY 3.0; `resources/sounds/NOTICE.md` has the attribution and lists
exactly what was changed.


## What's here

**Browsing.** Tabs with drag-to-reorder, pinning, muting and groups; up to four
panes side by side with draggable splits; profiles with separate cookie jars;
ad and tracker blocking (Ghostery lists); full-text history search over the page
text, not just titles.

**Site permissions.** Camera, microphone, location, notifications, screen share,
clipboard read, MIDI, HID/serial/USB and the rest are asked for once per origin
and remembered, with a sheet that names the site and the exact capability.
Screen sharing gets its own picker — Chromium's built-in one is unreachable from
Electron — showing every screen and window as a live thumbnail. Excluded sites
are refused without a prompt. Everything granted is listed and revocable in
**Settings → Sites**.

**Passwords.** Saved through `safeStorage`, so the row on disk is a keychain-
sealed blob and never plaintext. Capture watches for a single password field
(two means a sign-up or a change-password form, where the pair worth keeping is
ambiguous, so those are left alone) and offers to save; fill only works when the
page's origin matches the saved one. **Settings → Passwords** lists, reveals and
deletes.

**Extensions.** Point **Settings → Extensions** at an unpacked directory holding
a `manifest.json`. Content scripts, `chrome.storage` and `declarativeNetRequest`
work; toolbar popups and blocking `chrome.webRequest` do not, because Electron
implements a subset of the extension APIs rather than the whole surface.

**Printing.** ⌘P opens the system print dialog, ⌘⇧P writes a PDF of the page to
a location you choose.

**The sidebar.** Chat against the page you are on. `@` pulls in another tab, the
whole window, your selection or your history. `/` runs a skill. Streaming text,
optional visible thinking, tool steps you can expand, and inline citations that
open in a background tab.

**Skills.** Ten ship built in (`/summary`, `/write`, `/code`, `/compare`,
`/extract`, `/explain`, `/video`, `/reply`, `/fact-check`, `/shop`). A skill is a
prompt template plus a declaration of what context it pulls in automatically, and
optionally a hotkey. Built-ins can be edited and reset; yours can be anything.

**Memory.** Open Search writes short assertions about you as you browse, and reads them
back as *background, never as instructions*. Everything is visible and deletable
in one panel.

**Connectors.** Open Search is a plain MCP client — stdio and streamable HTTP. Point it at
anything that speaks MCP. The presets cover GitHub, Notion, Linear and a scoped
filesystem, each checked against its live endpoint. Gmail, Calendar and Slack are
listed but deliberately blank: their reference servers were deprecated on npm and
there is no official replacement, and a preset that hands an unvetted package
your mailbox is worse than no preset.

**Morning brief.** A once-a-day pass over your calendar, mail, the tabs you left
open, and your reading list.

**Decks and reports.** Describe what you need; Open Search reads your tabs, searches where
it has to, and writes a `.pptx` or a `.md` into `~/Downloads`.

**Sync.** One AES-256-GCM file (scrypt-derived key) in a folder you choose. Put it
in iCloud and your other machines pick it up. Tabs, groups, memory, skills,
bookmarks and settings travel. The API key does not.

## How it decides what to ask you about

Every tool Open Search can reach is sorted into an action class, and the class decides
whether it runs or stops and asks:

| Class | Examples | Default |
|---|---|---|
| `read` | read a page, list tabs, search history | runs |
| `local_reversible` | open a tab, group tabs, remember a fact | runs |
| `external_draft` | write into a field without sending | asks |
| `external_write` | send, post, create outside Open Search | asks |
| `sensitive` | money, deletion, credentials | **always asks** |

MCP tools are classified by name and description on connect; anything ambiguous
lands in `external_write`, not `read`. You can widen the first four in
**Settings → Approvals**. `sensitive` is not configurable.

## Two rules that are structural, not settings

**Pages are data.** Page text and search results reach the model inside a marked
block with an explicit instruction that they are content to report on, never
commands to follow. If a page tries to give Open Search orders, Open Search says so instead of
obeying.

**Open Search drafts, you send.** `insert_text` writes into a focused field and dispatches
input events. There is no tool that submits a form or sends a message.

## Layout

```
src/
  shared/      types.ts, ipc.ts — the contract both sides compile against
  main/
    store/     db (SQLite + FTS5), settings, built-in skills, sync
    browser/   session, adblock, url resolution, tabs, window,
               permissions (consent + screen picker), passwords, extensions
    agent/     engine (streaming + approvals), tools, context, mcp,
               skills, brief, deck, oneshot
    ipc.ts     every channel
    menu.ts    app menu + page context menus
  preload/
    chrome.ts  the window.kia bridge (chrome + overlay renderers)
    page.ts    window.__kia — Readability extraction, selection, insert
  renderer/
    src/       chrome UI (App, tab strip, toolbar, sidebar, panels)
    src/overlay/  palette, omnibox, writing tools, permission sheet,
                  screen picker, save-password prompt
test/          vitest over the pure logic; `electron` and `better-sqlite3`
               are aliased to stubs so main-process modules import cleanly
```

The window is a `BaseWindow` holding three `WebContentsView`s: the chrome (full
window), the tab views (positioned in the content rect, detached when offscreen),
and a transparent overlay added last so the palette paints above page content.
There can be several; ⌘N opens another, each with its own tabs and its own
restore set, and IPC routes by which window a message came from rather than by
which one has focus.
