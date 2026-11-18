# 02: Emscripten port

## Goal

Single-player Duke Nukem 3D runs in a browser: an Emscripten/WASM build with the software renderer, keyboard and mouse, sound effects, saved config and games, and a shell page. It is jfSW's brief 02 (and the page fixes of its 02c) for Duke, on the same engine, with the same names, file layout, scripts and tests wherever that makes sense, so that the two games stay easy to maintain together.

## Read first

- [`README.md`](README.md); [`PROMPT.md`](PROMPT.md); [`00-setup.md`](00-setup.md), Outcome (the emsdk set-up, the `emscripten-ports` branch, test data and the headless run).
- [`code-facts.md`](code-facts.md): section 4 (every loop that waits, and which of `handleevents()`, `getpackets()` and `nextpage()` it calls), section 6 (GRPs, the search path, CON scripts), section 10 (the engine's page hooks are named `Module.jfsw*`), section 8 (menus).
- jfSW's side, in `jfsw-browser` (branch `claude`): `doco/browser/02-emscripten-port.md` and `02c-focus-loss.md` (briefs and Outcomes), `Makefile.emscripten`, `scripts/build-wasm.sh`, `scripts/setup-firefox.sh`, `web/`, `tests/web/`. `git log --first-parent claude` there finds the 02 and 02c merges.
- [`building.md`](building.md) section 6.

## In scope

### 1. Build

- `Makefile.emscripten`, included by `Makefile` when the compiler is `emcc` (`PLATFORM=EMSCRIPTEN`, which the engine fork's `Makefile.shared` already recognises). `scripts/build-wasm.sh` wraps it and writes `build-wasm/` (git-ignored). The native build is unchanged.
- Emscripten 6.0.13 from `scripts/setup-emsdk.sh`; in the cloud container the install of jfSW's checkout is reused through `EMSDK_DIR` (the same revision and the same seeded SDL2 port): no second download.
- `USE_POLYMOST=0 USE_OPENGL=0` (D6), no startup window, no map editor, `-sASYNCIFY` (D7) as jfSW. The browser links the engine library's `mmulti.c` (see Notes).

### 2. Yields (D7)

- The blocking loops stay. The engine already yields in `handleevents()` and `showframe()`. **Every loop of `code-facts.md` section 4 must reach one of them**; add a yield to the game only where a loop does not.
- Exits: `exit()` from anywhere ends in the page's "The game has ended" or error overlay (done by jfSW's page code).

### 3. Platform and page

- `web/index.html`, `web/jfduke3d.js`, `web/jfduke3d.css`, `web/config.js`: jfSW's page as of 02c, same structure and names (`Module.jfsw*`, `window.jfsw*`, `JFSW_CONFIG`). Present: click to start (audio opens in the click), status line and errors on the page, canvas fit, pointer lock and Escape handling, the refused-promise handling of 02c, the unlocked-mouse filter, IDBFS persistence of `/persist` (`duke3d.cfg`, saves) with the `FS.close` hook, test hooks behind `?test=1` and `testMode`. Left out until the briefs that need them: the data download, cache and picker (03), the lobby and `?host=` / `?join=` (05), the data-mismatch notice (05b).
- **Game data:** a dev loader as in jfSW's 02: `?data=<url>`, default a same-origin `duke3dshare.grp`; no cache. Brief 03 replaces it.
- **CON scripts come from the GRP only** (decision): the page puts no loose file in the game's folder. The only way for one to get there is the test-only `?files=` (needs `?test=1` and `testMode: true`).
- Config and saves persist (IDBFS). Duke writes `duke3d.cfg` only when it quits; `menus()` now writes it when the menu is left, as jfSW's `ExitMenus()` does.

### 4. Tests (`tests/web/`)

Ported from jfSW's 02 and 02c: `smoke.js`, `persist.js`, `focus.js` (Chromium, required), `firefox.js` with `scripts/setup-firefox.sh` (optional), and `loops.js` (new: the loops of section 2). `make test-web` runs the required ones. **Every new check must fail without its fix**: each has a sabotage switch or a before-the-fix build, recorded in the Outcome. The "no frame stall over 100 ms" check of jfSW's `determinism.js` belongs to the determinism test below.

## Out of scope

Networking in the browser (04), data download, `data.js`, the file picker (03), host and join (05), the GL renderer, music, touch controls.
**The native-against-wasm determinism test** is deferred to a later brief: it needs brief 01's `-testdump` (and a demo recorded natively), which does not exist yet. The frame-time measurement of jfSW's 02 goes with it.

## Tests

1. `smoke.js`: the page loads the data and the click starts the game; the canvas is not blank (and the blank check can fail); the intro ends by itself and the main menu opens; a key skips each intro screen; Up and Down move the menu cursor; frames keep coming; the audio device is open and its clock runs; a click locks the pointer; no page error; the GRP is recognised; New Game starts a level (the skill voice is waited for); the keyboard moves the player; Escape opens and closes the menu; the pointer-lock checks of jfSW (a release by the game does not open the menu, the unlocked mouse does not turn the view, a release by the browser sends Escape); quitting ends the game and the page says so.
2. `persist.js`: a save and `duke3d.cfg` survive a reload (and the game loads the save); a setting changed in the menu survives a reload without quitting; a save survives a reload 250 ms after it was written; the same steps with `?persist=0` lose everything.
3. `focus.js` (02c): a refused pointer lock, a lost focus, and a real trap or script error in the game's frame.
4. `loops.js`: the loops of `code-facts.md` section 4 that the shareware data can reach (listed in the Outcome), each with the page responsive while it waits and the loop ending (by key or by time).
5. The native build still builds and `make test` (brief 00's tests) still passes.

## Acceptance criteria

1. The browser build compiles from a fresh recursive clone with the documented commands.
2. Tests 1 to 5 pass; counts and sabotages are in the Outcome.
3. A person can play the first shareware level in Chromium and Firefox with keyboard, mouse and sound effects (play-test steps in the Outcome).
4. The native build is unchanged in behaviour; the game changes are `#ifdef __EMSCRIPTEN__` and small.

## Dependencies

00. Runs in parallel with 01 (native relay games and test hooks): keep `Makefile` edits to the wasm parts and `game.c` edits to loops.

## Notes

- **Names.** The engine calls `Module.jfsw*` hooks; the Duke page provides those names, so the engine stays shared with jfSW. The page files are `jfduke3d.js` / `jfduke3d.css`; the output is `duke3d.js` / `duke3d.wasm`.
- **`mmulti`.** Decision: link `mmulti_null.c` until brief 04. The engine fork at `5950d14` no longer has that switch (jfSW's brief 04 made the browser's `mmulti.c` the vnet-backed one, and `sdlayer2.c` calls `mmulti_vnet_active()`), and the forks are not to change here, so the build links `mmulti.c`; with no `-net` arguments it is the single-player stub.

## Outcome

(Written at the end of the work.)
