# Open Search — working notes

Read `README.md` first; it is the map. This file is the stuff that only matters
when you are changing the code.

## Invariants

- **`src/shared/types.ts` and `src/shared/ipc.ts` are the contract.** Any channel
  with a reply goes in the `IPC` table before you use it, so main and renderer
  cannot drift on a name. The exception is the one-way `kia:open-<panel>` /
  `kia:focus-<target>` family, derived from the panel name at both ends. Main and
  renderer compile against the same types; drift shows up as a typecheck failure,
  not a runtime bug.
- **Main and preload are CJS.** `package.json` has no `"type": "module"` on
  purpose — `__dirname` has to resolve in `window.ts` and `tabs.ts`, and the
  native modules load as CJS. Preload output is `[name].js` for the same reason.
- **`@mozilla/readability` is bundled, not externalized.** The page preload runs
  with `sandbox: true` and cannot `require` out of `node_modules`. That exclusion
  lives in `electron.vite.config.ts`.
- **Never widen the `sensitive` action class.** `engine.needsApproval` ignores the
  settings for it deliberately.
- **`isExcluded` fails closed.** An unparseable URL is treated as excluded.
- **The sync bundle strips `ai.apiKey` and `sync` on import.** A bundle must not
  be able to overwrite machine-local secrets.

## Things that will bite you

- `better-sqlite3` needs no Electron rebuild — v13 ships N-API prebuilds that load
  under Electron 38 (ABI 139). `electron-rebuild` reports "Complete" and does
  nothing, because `binding.gyp` detects the prebuild and skips. Verified by
  running the probe under `ELECTRON_RUN_AS_NODE=1`.
- Ghostery's cosmetic-filter injection takes a one-shot `did-stop-loading`
  listener per `executeJavaScript` call, and a filter-heavy page runs to
  hundreds, so `wire()` sets `setMaxListeners(0)`. That warning is not a leak.
  The same code (`adblocker-electron/dist/commonjs/index.js`, the `for (const
  script of scripts)` loop) wraps an async call in a `try/catch` that only sees
  synchronous throws, so a failing scriptlet rejects unhandled. `index.ts`
  installs a `process.on('unhandledRejection')` that logs it.
- Closing a tab from inside a webContents event handler crashes Electron.
  `TabManager.close` defers `webContents.close()` with `setImmediate`.
- The overlay is added to `contentView` **last** so it paints above tab views;
  `layout()` inserts tab views at `overlayIndex()` to keep it that way.
- Session restore is per **window**, not per profile: `saved_tabs.window_key`
  scopes it, and `KiaWindow.key` is what a window carries across a quit. Two
  windows on one profile would otherwise re-open each other's tabs and then
  overwrite them. Closing a window by hand drops its key; quitting keeps it.
- IPC resolves the sending window from `event.sender`, carried through an
  `AsyncLocalStorage` so `win()` still takes no arguments. Do not go back to
  "whichever window has focus" — a background renderer can send.
- Send to a renderer with `post()` from `browser/window.ts`, never
  `webContents.send` directly. Between a renderer dying and its view being torn
  down, `isDestroyed()` is false but the frame is gone and `send` throws.
- `setPermissionRequestHandler` is async and may prompt; `setPermissionCheckHandler`
  is sync and cannot. Both live in `browser/permissions.ts` and must agree on
  `AUTO_GRANTED`, or a site is told it has a capability it will be refused. A
  permission the app has never heard of is denied, not granted.
- `setDisplayMediaRequestHandler` gets a `WebFrameMain`, not a `WebContents` —
  resolve it with `webContents.fromFrame()`. `callback({})` is the refusal, and
  with `useSystemPicker: false` Electron does *not* fall back to Chromium's own
  picker, so the app has to draw one.
- `setDevicePermissionHandler` carries no frame, so the profile cannot be
  recovered from the request. `sessionFor` takes the profile id and closes over it.
- `app.getPath('userData')` **creates** the directory. A migration that renames
  the profile directory has to build the path from `appData` instead, run at
  module load (not `whenReady`), and delete the three `Singleton*` symlinks it
  moves — a stale one makes `requestSingleInstanceLock()` return false and the
  app quits silently with no log.
- **The renderer cannot `fetch` its own files.** In production the chrome loads
  with `loadFile`, so its origin is `file://` and Chromium treats a
  same-directory `fetch` as cross-origin. It works under `electron-vite dev`
  (http://localhost) and fails silently once packaged. Anything the renderer
  needs as bytes comes from main over IPC — see the opening audio in `ipc.ts`.
- `app.getAppPath()` is not the project root. Electron sets it to whatever it
  was pointed at: the root under `electron .`, but `out/main` when handed the
  built script. Resolve unpackaged asset paths from `__dirname` instead.
- `before-quit` persists every window and closes the database, and only then do
  the windows actually close. Anything in a `closing` handler that touches the
  store has to bail out once cleanup has run, or it throws on every quit.
- The opening (`components/Splash.tsx` + `startupSound.ts`) is claimed once per
  launch by a flag in `ipc.ts`, not per window. While it runs, `layout()`
  detaches every tab view — the story is drawn by the chrome, which sits
  underneath them.

## Tests

`npm test`. Vitest, `test/**/*.test.ts`, no Electron. `vitest.config.ts` aliases
`electron` and `better-sqlite3` to stubs in `test/stubs/`, which is what lets a
main-process module be imported at all — the SQLite stub throws on construction,
so a test that accidentally opens the database fails loudly.

What is covered is the logic that decides something: url resolution, the action
classes and the approval policy, the exclusion list, the sync bundle's crypto and
its strip-on-import, and the permission decision order. Anything needing a live
`WebContents`, a real database or the Anthropic API is not.

Two bugs the first run of this suite found, both worth remembering: `\b` does not
tokenize `create_payment` (underscore is a word character), and `isExcluded`
returned false for every hostless URL because no entry can substring-match an
empty hostname.

## Adding a tool

`src/main/agent/tools.ts`. A `KiaTool` is a definition, an `actionClass`, a
`describe` for the approval sheet, and a `run`. The class is not decoration — it
is what decides whether the engine stops and asks. If a tool can cause an effect
someone else can see, it is at least `external_write`.
