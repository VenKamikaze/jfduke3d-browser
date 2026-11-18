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
2. `persist.js`: a save and `duke3d.cfg` survive a reload (and the game loads the save); a setting changed in the menu survives a reload without quitting; a save survives a reload 250 ms after it was written; the same steps with `?persist=0` lose everything; with no IndexedDB the page starts and says nothing will be kept.
3. `focus.js` (02c): a refused pointer lock, a lost focus, and a real trap or script error in the game's frame.
4. `loops.js`: the loops of `code-facts.md` section 4 that the shareware data can reach (listed in the Outcome), each with the page responsive while it waits and the loop ending (by key or by time).
5. `frametime.js`: the frame intervals over 40 s of play; median at 60 Hz and no stall over 100 ms (the second **fails in the cloud container**, as jfSW's did).
6. The native build still builds and brief 00's `tests/run-headless.sh` still passes.

## Acceptance criteria

1. The browser build compiles from a fresh recursive clone with the documented commands.
2. Tests 1 to 6 pass, except the known stall check of test 5; counts and sabotages are in the Outcome.
3. A person can play the first shareware level in Chromium and Firefox with keyboard, mouse and sound effects (play-test steps in the Outcome).
4. The native build is unchanged in behaviour; the game changes are `#ifdef __EMSCRIPTEN__` and small.

## Dependencies

00. Runs in parallel with 01 (native relay games and test hooks): keep `Makefile` edits to the wasm parts and `game.c` edits to loops.

## Notes

- **Names.** The engine calls `Module.jfsw*` hooks; the Duke page provides those names, so the engine stays shared with jfSW. The page files are `jfduke3d.js` / `jfduke3d.css`; the output is `duke3d.js` / `duke3d.wasm`.
- **`mmulti`.** Decision: link `mmulti_null.c` until brief 04. The engine fork at `5950d14` no longer has that switch (jfSW's brief 04 made the browser's `mmulti.c` the vnet-backed one, and `sdlayer2.c` calls `mmulti_vnet_active()`), and the forks are not to change here, so the build links `mmulti.c`; with no `-net` arguments it is the single-player stub.

## Outcome

Status: **review** (branch `browser/02-emscripten-port` in jfduke3d-browser only: the forks and vnet are unchanged). Single-player Duke Nukem 3D (shareware 1.3D) runs in Chromium from `scripts/build-wasm.sh`; the native build is unchanged and `tests/run-headless.sh` passes (24/0). Not tested: a real GPU, a real sound card, a person playing, Firefox other than headless.

**What landed**

- **Build.** `Makefile` (an `EMSCRIPTEN` block: `-DDATADIR=\"/data\"`, `-O2`; `all: wasm` and `include Makefile.emscripten` under `emcc`; a `test-web` target), `Makefile.emscripten` (jfSW's, with Duke's names: `-sASYNCIFY`, `ASYNCIFY_STACK_SIZE=262144`, memory growth, `EXIT_RUNTIME`, `INVOKE_RUN=0`, IDBFS, `-lwebsocket.js`), `scripts/build-wasm.sh` (output `build-wasm/`: `index.html`, `jfduke3d.js`, `jfduke3d.css`, `config.js`, `duke3d.js`, `duke3d.wasm`). From a fresh recursive clone, with a clean private Emscripten cache seeded by `setup-emsdk.sh --with-ports` (EMSDK_DIR pointing at jfSW's install, no second download): **52 s** for the whole build on 4 cores. `build-wasm.sh veryclean` also removes the native `duke3d`.
- **`mmulti`: a deviation from the decision.** The brief and the decision said to link `mmulti_null.c`. The engine fork (`5950d14`) no longer has that switch (jfSW's brief 04 removed it, and `sdlayer2.c` calls `mmulti_vnet_active()`), and the forks are not to change, so the browser links the real `mmulti.c` with vnet (UDP compiled out under `__EMSCRIPTEN__`). The page passes no `-net`, so it is the single-player stub (`numplayers = 1`); `?args=-net ...` in test mode would try a relay. Noted in `building.md` 6.2 and `code-facts.md` 16.10.
- **Yields: none needed in the game.** Every loop of `code-facts.md` section 4 calls `handleevents()` and/or `nextpage()`, where the engine already yields (re-read of every `while`/`do`/`for` in `src/` that waits; `code-facts.md` 16.1). `tests/web/loops.js` proves it for the loops that the shareware data reaches: `Logo()` (the 3D Realms screen and the title, with `fadepal`/`palto`), `newgame()`'s wait for the skill voice and the level loading (`precache`, `waitforeverybody`), and the whole `dobonus()` path of the end of episode 1 (the animation `while (1)`, the story and order `userack()` screens, the "completed" `while (1)`, back to the menu), plus `userack()` at quit (smoke). **Not reachable with the shareware GRP, so untested in the browser:** `playanm()` (no `.anm`), `playback()` (no demo), the E2 to E4 end sequences including E3's five `issoundplaying()` waits, the multiplayer `FRAGBONUS` screen and `allowtimetocorrecterrorswhenquitting` (no networking), the start-up network wait. The sound waits (`newgame`, E3) need the audio mixer to run; `newgame()`'s was exercised.
- **Page (`web/`), compared with jfSW's current page (brief 02c's).**
  - *Present:* click to start (audio opens inside the click), status line, progress, errors on the page, the "game has ended / crashed" overlay and reload button, canvas fit, Escape and pointer lock (a lock lost to the browser sends the game an Escape), the unlocked-mouse filter, 02c's refused-promise handling (`quietRefusal()` for `requestPointerLock`, fullscreen, `AudioContext.resume`), 02c's `gameError()` (a trap shortly after an exit replaces "The game has ended"), IDBFS for `/persist` with the `FS.close` hook and the sync queue, the "no IndexedDB" note, the `?test=1` hooks (`jfswTest`, `jfswOut`, `jfswExit`, `jfswState`, `Module.jfswFrameLog`, `jfswYieldLog`, `jfswShowframes`, `jfswKnobs`, `?args=`, `?files=`, `?persist=0`, `?idb=off`), `config.js` with `testMode` and `relay`.
  - *Inert:* `config.js`'s `relay` (nothing reads it), the `Module.jfswKnobs` object (the engine's `mmulti_vnet.c` reads it; empty), the hidden-tab hooks the engine calls (`jfswChan`, `jfswPending`, ... are set by the engine itself; a single-player game in a hidden tab pauses as jfSW's does).
  - *Omitted (later briefs):* the data download, cache, `grptable.js`, `data.js`, the "use your own copy" picker and the data-mismatch notice (03, 05b), the lobby, `?host=` / `?join=`, `jfswNetGame`, the notice (05, 05b), the WebTransport expectation in the unhandled-rejection handler (06b), `?wake_every`, `?stall`, `?revalidate`, `?idb=quota`, the relay knobs.
  - *Game data:* jfSW's 02 dev loader: `?data=<url>`, default a same-origin `duke3dshare.grp`, written as `/data/duke3d.grp`; no cache. **CON scripts: from the GRP only.** The page writes no loose file; `?files=` (needs `?test=1` and `testMode: true`) is the only way, and only `loops.js` uses it (a loose GAME.CON that ends the episode).
- **Game change (one).** `menus()` in `src/menues.c` writes `duke3d.cfg` when the menu is left (`#ifdef __EMSCRIPTEN__`, a static flag and 7 lines), as jfSW's `ExitMenus()` does: Duke writes it only at `Shutdown()` (`code-facts.md` 16.8), which a closed or reloaded tab never reaches. No loop was touched. Nothing in the simulation changed.

**Commits** (branch `browser/02-emscripten-port`, from `claude` `7e0cd72`): `9d3ee53` build, page, the `menus()` change; `d583c68` the tests, `make test-web`, `setup-firefox.sh`, the brief and `building.md`; `367d06e` `frametime.js`, `code-facts.md` 15, `bugs.md` D3 and D4; `12e4895` the no-IndexedDB check and this Outcome; and `6971eba` the commit list; then the merge of `origin/claude` (brief 01, `cab7a05`), which renumbered this brief's bugs to D3 and D4 and its code-facts section to 16, and checked that `src/netgame.c` and `src/testhooks.c` build into the wasm (they are in `GAMEOBJS`) and that the D14 gate (`NetGameAllowed()`, `AllowSharewareNetGames`, `-allowsharewarenet`) is compiled in and only runs when `-net` arguments are given, so single player is untouched.

**Tests** (Chromium through Playwright, one at a time under `flock /tmp/jfd-heavy-tests.lock`, load 2 to 3 on 4 cores; Firefox 160.0 and puppeteer-core 25.17.0 from jfSW's cache through `FIREFOX_CACHE`)

| Test | Result |
|---|---|
| `smoke.js` | **36 passed, 0 failed**, twice in a row (about 1.5 minutes) |
| `persist.js` | **18 passed, 0 failed** (about 4 minutes) |
| `focus.js` | **24 passed, 0 failed** (jfSW's part 3, the 05b notice, is not ported) |
| `loops.js` | **18 passed, 0 failed** in 4 of 5 full runs; the fifth had **one failed window**: "after New Game, seconds 6 to 9: largest gap 1,089 ms, 7 frames, 3 yields a second" on a machine at load 3 shared with another agent's tests (the next three runs: largest gaps 100 to 423 ms). The window's limit (1 s) is not loosened; a gap of that size in 5 runs is the container's stall, not a loop that does not yield (a loop that never yields stalls for the whole wait, as the `hang` sabotage shows), but it is a flake to know about (about 2 minutes) |
| `frametime.js` | **3 passed, 1 failed**: the known "no stall over 100 ms" check (below) |
| `firefox.js` (single player and the trap only) | **10 passed, 0 failed** |
| native: `make -j4`, `tests/run-headless.sh` | built; 24 passed, 0 failed |
| fresh recursive clone of the pushed branch, clean private Emscripten cache: `smoke.js` against its `build-wasm/` | **36 passed, 0 failed** |

**Every new check fails without its fix** (sabotage switches, or a build or page without the change). "Fails" counts are of the run, not only of the intended check:

| Switch or build | Run | What failed |
|---|---|---|
| `SMOKE_SABOTAGE=blank` | smoke | 1: the canvas is not blank (1 colour). The blank check also first fails on known-blank pictures (before the game starts, one and two colours) and passes on a 12-colour one |
| `SMOKE_SABOTAGE=nokey` | smoke | 11: Down, Up, the intro skip, New Game, the keyboard moves the player, Escape opens and closes the menu, the unlocked-mouse view check (the title screen was still up), quit, the end overlay, frames (machine busy) |
| `SMOKE_SABOTAGE=noesc` | smoke | 1: when the browser takes the pointer the game's menu opens (0 pixels changed) |
| `SMOKE_SABOTAGE=unlockedmouse` | smoke | 1: moving the mouse while released does not turn the view (163,286 pixels changed) |
| `SMOKE_SABOTAGE=slowclock` (the clock at 1/5: `Date.now` and `performance.now`) | smoke | 3: the intro ends by itself and the main menu is up (not after 36 s), Down, Up |
| `SMOKE_SABOTAGE=noquit` | smoke | 2: quitting ends the game and the page says so; the overlay |
| build without the `menus()` change (`src/menues.c` from `7e0cd72`) | persist | 1: leaving the menu wrote `duke3d.cfg` with the changed setting (null; and, with the later `changed !== null` condition, the reload check) |
| page with `syncfs(true).catch` rethrowing | persist `PERSIST_ONLY=idb` | 2: the page is ready and says nothing will be kept ("Could not start: simulated: IndexedDB is not available"); the game starts and runs |
| `FOCUS_SABOTAGE=unhandled` | focus | 12 of 24, with "Something went wrong: The document is not focused. Reload the page to try again." |
| page with `fromGame()` always false | focus | 6: a trap or script error in the game's frame says "The game has ended." (jfSW's L33) |
| `FIREFOX_SABOTAGE=unhandled` | firefox | 7 of 10, the same message |
| `LOOPS_SABOTAGE=nokey` | loops | 2: the level was never loaded (no key chose New Game), the end sequence never returned to the menu |
| `LOOPS_SABOTAGE=hang` (the main thread held 1.5 s inside the first measurement, as a loop that never yields would) | loops | 1: intro, seconds 0 to 3 (largest gap 1,541 ms, 1 yield a second) |

**Frame time** (`frametime.js`, 36 s of turning and walking in E1L1 after the first seconds, Chromium headless with software rendering, 4 cores, load about 2.5): median 16.8 ms (60 Hz), p95 38 ms, p99 110 ms, max 312 ms, 12 gaps over 100 ms in 40 s. **The "no stall over 100 ms" check fails here** and is kept as it is; the game itself uses a median 1.3 ms (p95 3.0 ms, mean 1.55 ms) of each frame between yields and the stack rewind after a yield costs 0.0 ms (p99 0.1 ms), so the stalls are the container's browser. It needs a run on real hardware (play-test steps). jfSW's own check of this kind lives in its determinism test, which Duke gets later; `frametime.js` stands in until then.

**ASYNCIFY cost** (`-O2`; the no-ASYNCIFY build is `CPPFLAGS=-DJFBUILD_NO_ASYNCIFY scripts/build-wasm.sh ASYNCIFY=0`, which cannot run): `duke3d.wasm` 1,422,591 bytes without ASYNCIFY, 1,915,695 with it (+35 % raw; gzip 484,022 to 616,120, +27 %); `duke3d.js` 179,148 to 187,760 bytes (gzip 45.9 KB to 48.1 KB). The download is about 664 KB gzipped plus the 11 MB shareware GRP. The default ASYNCIFY settings are kept, as in jfSW.

**Findings**

- `code-facts.md` section 16 (new; 01's §15 stays): the loops, the keys that end an intro screen, the menu hotkeys, F6 and the save menu, when `duke3d.cfg` is written, the shareware GRP's contents, the game's clock (`Date.now`), the `mmulti` link, `endofgame` in a CON, and the page's file names. Section 10's "no `Makefile.emscripten`" is now out of date (fixed in place).
- **jfSW's `warpScript()` has no effect on the game.** SDL's Emscripten build reads the time with `gettimeofday()` (`Date.now`), not `performance.now()`. Its determinism test ran at 1x, so nothing there broke; the copy in `tests/web/lib.js` here changes both clocks (the `slowclock` sabotage depends on it), and jfSW's `lib.js` could take the same fix.
- **Bugs in the original game** (`bugs.md`): **D3** F4 in a game stops it in an undrawn, unclosable menu (`cmenu(701)` has no `case`); **D4** (unconfirmed) a menu hotkey moves the cursor but does not choose. Neither was fixed.
- No difference between native and wasm behaviour was looked for (that is the deferred determinism test); no `wasm-ld` signature warning came up in the build (jfSW's `SpawnBreakFlames` kind of bug), and the game ran without a trap through the intro, three menus, a level, saving, loading and the episode end.

**Not done**

- **The native-against-wasm determinism test, and with it the demo and the frame-time check in its jfSW form, are deferred** to a later brief: they need brief 01's `-testdump` (and a demo or a scripted input recorded natively). `frametime.js` covers the frame-time numbers meanwhile.
- Music (out of scope; Duke's start-up accepts the missing MIDI driver, and the sound options show music "on").
- The loops listed under "Yields" that the shareware data cannot reach. They need the registered GRP (brief 03's data) or networking.
- Firefox was tried only headless, single player, through `tests/web/firefox.js`; jfSW's Firefox network and WebTransport parts are not ported (brief 04 on). No real Alt+Tab check (jfSW's 02c did one by hand; the page code is the same).

**Concerns and open questions**

- **`mmulti_null` (correction after the merge with brief 01):** the coordinator decided there is no `-DJFBUILD_NO_VNET` switch in the fork; linking the real `mmulti.c` without `-net` is accepted (it is the single-player stub). The question is closed.
- **`-O2` for the game:** native `Makefile` compiles at `-O1` (upstream default); the browser build rewrites that to `-O2` in its own `ifeq` (`CFLAGS:=$(patsubst -O1,-O2,$(CFLAGS))`), as jfSW's `-O2` default. Not measured against `-O1`.
- **Hidden tab, single player:** as in jfSW, `requestAnimationFrame` stops and the engine falls back to a timer (the game then runs about once a second and `sampletimer()` caps a clock step at a quarter second): a pause, not a crash. Not tested here.
- **Browser keys:** F5 (change music in Duke), F11, F12 and Ctrl+W/Ctrl+Tab belong to the browser; the page does not stop them. `KB_KeyWaiting()` ignores Shift, Ctrl and arrows, so those do not skip the intro (as on the desktop).
- **The audio waits:** `newgame()` and the E3 ending loop until the sounds end. With a suspended `AudioContext` (a page that never got a click) they would spin without yielding to the page's events for long; the click-to-start overlay prevents that. If audio ever failed to start for another reason the game would hang there; not seen.

**Play-test steps for the user (Arch, pacman)**

```
sudo pacman -S --needed base-devel git unzip python nodejs npm
git clone --recurse-submodules -b browser/02-emscripten-port https://github.com/VenKamikaze/jfduke3d-browser
cd jfduke3d-browser
scripts/setup-emsdk.sh                    # Emscripten 6.0.13, about 400 MB, into ~/.cache/jfduke3d-browser/emsdk
scripts/build-wasm.sh                     # about 3 minutes the first time (Emscripten's libraries and SDL2)
scripts/fetch-test-data.sh                # the shareware data: testdata/duke3dshare.grp (verified)
cp testdata/duke3dshare.grp build-wasm/
cd build-wasm && python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/` in Chromium and then in Firefox. Click "Click to start". Check:

1. The 3D Realms screen, the title screen (you can skip each with a letter key or Space), the main menu (arrows and Enter; Escape goes back).
2. New Game, "L.A. Meltdown", a skill: the level loads, **sound effects play** (the skill voice, the pistol); there is no music yet. Keys as in the desktop game: the arrows turn and move, Ctrl fires, Space opens doors, 1 to 9 pick weapons, Shift runs, `A` jumps, `Z` crouches. Does it feel smooth at your display's refresh rate?
3. **Mouse:** click the picture to capture it; mouse look and fire; **Escape** releases the mouse and opens the menu (once, not twice); click again to capture; that click should not also pick a menu item. In Firefox as well.
4. **Save and settings:** F6 (a save slot, type a name, Enter), reload the page, Click to start, F3 (the saved game is listed), load it. In Escape, Options, Sound Options, switch Sound off, close the menu, reload without quitting: it should still be off.
5. **Level end and quit:** play Hollywood Holocaust to its exit: the "completed" screen, then the next level. Quitting (F10, Y) shows the shareware order pages (a key for each), then the page says "The game has ended".
6. A private window (IndexedDB may be unavailable): the page should start and say that saves and settings will not be kept.
7. **Frame times on your hardware** (needs Node.js and Playwright with a Chromium on your machine: `npm i playwright && npx playwright install chromium`): `node tests/web/frametime.js` (about 1 minute; it prints the intervals and fails only if a frame takes over 100 ms). And the whole set: `make test-web` (about 10 minutes; the last test is that one).
8. Report anything that freezes (the page should always show a message when the game ends or crashes), a key that does nothing in Firefox, and anything that sounds late.

F4 in a game freezes the game in an invisible menu (`bugs.md` D3): don't use it.
