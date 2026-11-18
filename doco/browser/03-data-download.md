# 03: Game data download from a URL, CON scripts from the GRP only, and the native-against-wasm determinism test

## Goal

The browser build gets its game data the way decision D8 describes. The page downloads the GRP before the game starts, shows progress, detects a stalled download, and caches the file in IndexedDB, so a reload starts at once with no download and no re-checksum of the whole file by the game. A file picker covers people with their own copy (registered GRPs included). Every failure has a clear message. The server side is documented. This is jfSW's brief 03 (`jfsw-browser`, `doco/browser/03-data-download.md`) for Duke, with the same names, structure and code wherever that makes sense.

Two things are Duke's own. **CON scripts come from the GRP only** in the browser (D8): a loose `GAME.CON` must not override the GRP's, and the shareware network gate of decision D14 gets its `config.js` switch. And the **native-against-wasm determinism test** that brief 02 deferred: the same game played natively and in the browser from the same input gives the same `-testdump` records, tic for tic.

## Read first

- [`README.md`](README.md): D8, D11 (only the shareware GRP is offered for download by default), D14 (the shareware network gate), Q2 (the data source; the mirrors send no CORS headers).
- [`02-emscripten-port.md`](02-emscripten-port.md), Outcome: how the page starts the game and what is inert; the 02-style loader (`?data=`, a same-origin `duke3dshare.grp`) and the test-only `?files=` that this brief replaces and keeps.
- [`code-facts.md`](code-facts.md): §6 (GRPs, the search path, CON scripts, `kopen4load`'s search-order argument), §9 (demos), §15 (`-testdump`), §16 (what the browser build does).
- jfSW's `03-data-download.md` (brief and Outcome), `data-hosting.md`, `web/data.js`, `web/grptable.js`, `tests/web/data.js`, `tests/web/grptable.js`, `tests/web/determinism.js`, `tests/tools/synth_input.c`.
- `src/grpscan.c`: the known GRPs (name, CRC32, size) and how `grpfiles.cache` is keyed (name, size, mtime).

## Scope

### 1. Game data (jfSW's brief 03)

- **Configuration.** `web/config.js` (`JFSW_CONFIG.data`): `url`, declared `size` and `crc32`, `revalidate`. `?data=<url>` overrides the URL (and the declared values). The default is the shareware GRP from the page's own origin (D11).
- **Download with progress**, the percentage taken from the declared size when the response is compressed; checked before it is used or cached: the declared size, the declared CRC32, and the table of `src/grpscan.c` (kept in `web/grptable.js`, **generated from it**, and a test compares the two). A truncated or wrong file is never cached and never handed to the game. A download with no byte for 30 s is stalled and ends in an error.
- **IndexedDB cache**, a database of its own, keyed by URL, with the size, ETag, CRC32 and the time it was stored. A second load with a cached file makes no request; the stored bytes are checksummed again on every hit (a damaged copy is discarded and downloaded again). Replaced when the configured URL, declared size or CRC32 changes, by "Download again", and (opt-in `revalidate`) by a conditional request. Entries of URLs no longer configured are removed. `navigator.storage.persist()` is asked for. If storing fails (quota), the game starts from the downloaded copy with a notice.
- **No re-checksum by the game on reload:** the file is written to `/data/duke3d.grp` with a stable mtime (`FS.utime`), so the game's persisted `grpfiles.cache` hits.
- **File picker** ("Use your own copy of the game data..."): a `.grp`, checked the same way, cached under a key of its own; a registered GRP works. The page says which data it uses and offers the way back.
- **Clear errors** for HTTP errors, a CORS block or network failure (with the CORS hint for a cross-origin URL), a truncated download, a stalled download, a file that is not a known GRP (with its size and CRC32), a quota failure and unavailable IndexedDB (the last two do not stop the game). The game is never started on a bad file.
- `doco/browser/data-hosting.md`.

### 2. CON scripts from the GRP only

Decision (user): in the browser the simulation's scripts are the GRP's, so that players with the same GRP play the same game.

- The game reads `GAME.CON` and what it includes (`DEFS.CON`, `USER.CON`) through `kopen4load(name, 1)` (the first group file only) under `__EMSCRIPTEN__`, and `-x` can only name a script inside the GRP. A loose script in the game's folder is ignored. The one exception is test mode: the page passes `-testloosecon` only when `?test=1` **and** `testMode: true` are both set, and 02's `loops.js` relies on that (a loose `GAME.CON` that ends the episode, through `?files=`).
- The page never writes a loose file outside test mode (`?files=` is test-only, and `writeLooseFile()` refuses to write one otherwise).

### 3. The shareware network gate (D14)

`config.js` has `allowSharewareNetGames: false`. `true` makes the page start the game with `-allowsharewarenet`. It is for LAN deployments (the licence's clause [3][D]), and **nothing in the page address can turn it on**. Networking itself is brief 04: only the argument is tested.

### 4. The native-against-wasm determinism test

`tests/web/determinism.js`: a demo recorded natively from a scripted player is played back natively and in the browser, each with `-testdump`, and the records are compared tic for tic. Method, results and the finding that came out of it (bugs.md D15) are in the Outcome and in the header of the test.

## Out of scope

Networking in the browser (04), the lobby (05), the data and build identity warning (05b), the deployment guide (06), music. A native downloader (D8). Offering registered data for download (D11). Unpacking zips in the browser. The add-on GRPs and NAM (later). Any fix to a bug in the original game: bugs found go in `bugs.md` (D15 and up in this brief).

## Tests

Playwright with local HTTP servers (Chromium and Playwright are preinstalled; never run `playwright install`). Each test uses a fresh browser profile unless it tests the cache. **Every new check must fail without its fix**: sabotage switches are in the Outcome.

1. `tests/web/grptable.js` (no browser): `web/grptable.js` equals `src/grpscan.c`'s table (and is exactly what `--write` generates); `config.js` declares a GRP the table knows and ships with the safe defaults; the page's CRC-32 equals zlib's.
2. `tests/web/data.js`: first load (progress, one request, the cache record, the game reaches the main menu); cached second load (no request reaches the server, no `Checksumming` in the game's output); corrupt and truncated files; unknown files; HTTP 404/500 and a cross-origin server without CORS; compressed responses; the file picker; quota and no IndexedDB; configuration changes; "Download again" and revalidation; a damaged stored copy and a stalled download; the plain page has no test hooks; the shareware network gate (the argument is passed with `allowSharewareNetGames: true`, never from the address); `grpfiles.cache` reaches IndexedDB on its own.
3. `tests/web/con.js`: a loose `GAME.CON`, `DEFS.CON` and `USER.CON` in the game's folder are ignored on a visitor's page and read in test mode; `?loosecon=0` (test mode without `-testloosecon`) shows the game's own rule; `-x` of a script that is not in the GRP is not read; a crafted address cannot make the page write a loose file.
4. `tests/web/determinism.js`: see the Outcome.
5. Brief 02's `smoke.js`, `persist.js`, `loops.js`, `focus.js` still pass.

## Acceptance criteria

1. Tests 1 to 3 pass and brief 02's web tests still pass; the determinism test runs at least three times, with the results in the Outcome.
2. The second load starts with no download and no re-checksum.
3. Every error case gives a clear message and never starts the game on a bad file.
4. A loose CON script is ignored outside test mode and used in test mode; the page writes no loose file outside test mode.
5. `allowSharewareNetGames` adds `-allowsharewarenet` when true, and nothing in the address can.
6. `data-hosting.md` lets a person host the data correctly.
7. The Outcome has play-test steps for the first load, a reload, a bad URL and the file picker in Chrome and Firefox.

## Dependencies

02 (merged into `claude`), 01 (`-testdump`, the shareware gate).

## Notes

- **Git:** `browser/03-data-download` from `claude`. The game changes are `src/gamedef.c` (the CON search order) and `src/game.c` (one argument, `-testloosecon`): no engine fork changed.
- Keep the page code plain (no framework, no bundler). Dev knobs and test hooks only with `?test=1` and `testMode: true`.
- `window.jfswArgs` (the arguments the game was started with) is set in every mode, not only test mode: it is not a hook, and the tests of the network gate read it on the plain page.
- Two games on one origin do not work: this page's cache database is `jfduke3d-data` and jfSW's is `jfsw-data`, but the game's own IDBFS database is named after its mount point, `/persist`, in both games, so they would share it. Serve each game from its own origin (not changed here; see the Outcome).

## Outcome

Status: **review** (branch `browser/03-data-download` in jfduke3d-browser; the forks and vnet are unchanged, so no fork branch). The game changes are two small edits (`src/gamedef.c`, `src/game.c`); the native build behaves as before. Not tested: Firefox (not run here), a real network, a real Apache, a person.

**What landed**

- **The data download** (jfSW's brief 03 for Duke): `web/data.js` (CRC-32, download with progress and checks, the IndexedDB cache `jfduke3d-data`, the picked file), `web/grptable.js` (generated from `src/grpscan.c`: `node tests/web/grptable.js --write`), `web/config.js` (`data.url/size/crc32/revalidate`, `allowSharewareNetGames`), `web/index.html`, `web/jfduke3d.js`, `web/jfduke3d.css` (progress, "Game data: Shareware Version, downloaded ... from ..., kept in this browser", "Use your own copy of the game data...", "Download again", "Use the download instead", "Try again", the errors), `Makefile.emscripten` (copies the two new files into `build-wasm/`), `doco/browser/data-hosting.md`. How it works is jfSW's (its Outcome has the details: cache rules, checks in order, stall timer, what `revalidate` does); the points that are Duke's are below.
- **CON scripts from the GRP only**: see "How it is enforced" below.
- **The shareware network gate**: `allowSharewareNetGames: false` in `config.js` (with the licence comment); `true` puts `-allowsharewarenet` first in the game's arguments. Only `config.js` can set it.
- **The determinism test** (`tests/web/determinism.js`, `tests/tools/synth_input.c`, `tests/tools/build-native-clang.sh`) and what it found (D15).
- **Tests:** `grptable.js`, `data.js`, `dataserver.js` (jfSW's test server), `con.js`, `determinism.js`; `make test-web` runs them. `cursorFinder` moved from `smoke.js` to `lib.js` so that `data.js` can tell the main menu from the intro.
- **Docs:** `building.md` (6.3, 6.4, the layout table), `code-facts.md` §18, `bugs.md` D15 and D16, the README row, `data-hosting.md`.

**How CON-from-GRP-only is enforced** (two layers, both tested)

1. *The game* (`src/gamedef.c`): the CON loader's `kopen4load()` calls take `CONFROMGRPONLY`, which is `loadfromgrouponly` in the native build (no change) and `(LooseConAllowed ? loadfromgrouponly : 1)` under `__EMSCRIPTEN__`. `kopen4load(name, 1)` searches the first group file only (`jfbuild/src/cache1d.c`), so a loose `game.con`, `DEFS.CON` or `USER.CON` in the game's folder is never opened, and `-x<file>` can only name a script inside the GRP. The "Use default CONs instead?" tests use the same macro, so the shareware CON's one warning no longer reaches `wm_ynbox` in the browser. `loadfromgrouponly` itself is untouched: demos and sounds still read from disk first. `LooseConAllowed` is set by `-testloosecon` (`src/game.c`, with the other test arguments), which does nothing natively.
2. *The page* (`web/jfduke3d.js`): `gameArgs()` returns only `-allowsharewarenet` (when `config.js` says so) outside test mode, and adds `-testloosecon` in test mode (`?test=1` **and** `testMode: true`); `?loosecon=0` leaves it out (test only, so a test can show layer 1 alone). The page writes no loose file: `?files=` is read in test mode only, and `writeLooseFile()` throws outside it.

Why a game argument and not a build option: one build serves the tests and the visitors, and the test-only switch is something a link cannot set (it needs `testMode: true` in `config.js`, which a site owner controls).

**The determinism test: method and results**

- *Method.* The shareware GRP has no demo, so the input is made at test time. `tests/tools/synth_input.c` (jfSW's tool with Duke's keys) is an `LD_PRELOAD` shim for `SDL_PollEvent` that plays pseudo-random keys (walk, turn, fire, strafe, run, open, change weapon) into the native game with no display; the game records them (`-v1 -l1 -s2 -r`) and quits by itself at tic 2000 (`-testquit`). That `demo1.dmo` (5 to 6.5 KB; only inputs) is played back with `-ddemo1 -testdump -testquit1990`: natively twice (gcc), natively with a clang build, and in the browser (the page loads it through `?files=`), and the 32-byte records are compared. A second part goes the other way: the page types a player's keys for 24 s, the wasm game records `demo1.dmo` (890 tics), and native and wasm play it back. **Why this and not a test-only input hook in `testhooks.c`:** nothing in the game changes, so what is tested is the game, with the input a player would produce through the real input path (SDL, `getinput`, `record`, `playback`); the hook would also have been another edit in a file the parallel brief A1 changes. **Why recorded at test time and not a committed demo (jfSW commits one):** a demo holds nothing but inputs, so no golden file goes stale when the simulation changes (A1 changes it), and every run, and every `DET_SEED`, is another input. The cost is about 70 s of real time for the recording.
- *What it checks first:* the scripted player did something: it walked (12,000 to 78,000 units), fired (24 to 48 rounds), and either 4 or 5 of the 11 monsters of E1L1's start area were gone by the last snapshot (seeds 1 to 3) or the player lost 63 health (seed 4), and 52 to 88 different sector states (doors, lifts, lights) occurred. The thresholds ask for movement, at least 3 rounds fired, "hurt or something killed" and 10 sector states.
- *Results, six runs (`DET_SEED=1` to `6`; each a new recording; 1 to 3 before the last test edits, 4 and 5 on the final tree, 6 after the merge of `claude`), each 21 checks, 0 failed:*

| | tics compared | result |
|---|---|---|
| native (gcc) against native (gcc), two playbacks | 1990 | identical, every run |
| **wasm against native built with clang** | **1990 per run** | **identical, every run** (all six hashes and the seed, every tic) |
| wasm against native (gcc) | up to the first difference | **tic 210** in all six runs (sprites, hittype): D15 below; the same tic and parts as gcc-native against clang-native |
| browser-recorded demo, wasm against native built with clang | 890 per run | identical, every run |
| browser-recorded demo, wasm against native (gcc) | up to the first difference | differs (tic 159 in the first run, tic 210 in the others; sprites, hittype): D15 |
| mutation: wasm with `-testnudge600` against the reference | 640 | caught at tic 600, in the players' state; the 599 tics before agree |

So **the browser build and a native build made by the same family of compiler agree on every tic of 1990 + 890 tics, six times**, with monsters, shooting, doors and lifts, sector movement and pickups in play; the wasm run is as good as the clang one, and no difference of float, integer width, the C library, the sound clock or the frame rate showed (the wasm playbacks ran with frame stalls of up to 8.5 s on a loaded machine; the dumps are the same). **The native desktop build (gcc) and the browser differ from tic 210**, because of D15.
- *The finding, D15* (`bugs.md`): at tic 210 something in E1L1's start area makes a burst of scrap, and `RANDOMSCRAP` (and about 25 other calls) pass several `krand()` calls as arguments of one call; gcc evaluates arguments right to left and clang left to right, so debris gets other angles and speeds. The seed ends up equal, the sprites differ. This is a **real desync between a native gcc player and a browser player** in any game where something explodes (so in brief 04's games), and it is what the user's goal of "native players can join the same rooms" needs fixed. It is not fixed here (the rule: bugs go in `bugs.md`); the order the fix picks (gcc's keeps today's native games) is the coordinator's call; the fix is a brief of its own (README's rules for fixes apply), and the same test will show it.
- *How the failing comparison is treated.* "gcc native against wasm" is **a known failure (`KNOWN.D15` in the test)**: it is reported as `xfail` and does not fail the run, but it does fail when the first difference is anywhere other than where gcc-native and clang-native also differ (so nothing new hides behind it), and it fails when it starts to pass (D15 fixed: remove the expectation). `DET_STRICT=1` makes it an ordinary failure. The main comparison is wasm against the clang-built native game (`tests/tools/build-native-clang.sh`: an rsync copy of the tree built with `CC=clang` in `~/.cache/jfduke3d-browser/native-clang`, about 20 s the first time; the test needs `clang` and `rsync`; without them the test prints NOT RUN and exits 3, as `firefox.js` does: there is no valid fallback). After D15's first difference (tic 210) the gcc-native-against-wasm comparison says nothing about the rest of the demo, so **the strict check is clang-native against wasm**; the browser-recorded demo gets the same two-sided treatment. **Decision (mine):** the alternatives were a red test until D15 is fixed, or a test that compares only up to tic 209. The first blocks `make test-web` on a known bug and gives no signal about anything else; the second hides the problem. This keeps the signal (everything else is compared for the full length, and the known bug is shown on every run).
- *Mutation.* `-testnudge600` moves the player 8 units at tic 600 in the wasm game only: the comparison finds it at tic 600 in the players' hash, and the 599 tics before agree. A second proof that the comparison bites is D15 itself: two builds that differ (gcc and clang) are told apart.
- *Frame times* (info only, not a check: three native games run at the same time): see `frametime.js`, which measures them on a quiet machine. The "no stall over 100 ms" check stays there.

**Tests** (Chromium through Playwright, one at a time under `flock /tmp/jfd-heavy-tests.lock`, a 4-core container shared with another agent's runs). The results of every line below were obtained on the tree before the merge of `claude` (A1's merge `64bb15f`); after that merge, with the wasm and native builds redone, `grptable.js`, `con.js`, `smoke.js`, `data.js`, `loops.js`, `persist.js`, `focus.js` and `determinism.js` (seed 6) were run again with the same results.

| Test | Result |
|---|---|
| `node tests/web/grptable.js` | **12 passed, 0 failed** |
| `node tests/web/data.js` | **183 passed, 0 failed** (193 after the fix round below) (about 5 minutes): the first load (progress 1 request, cache record, the main menu, `grpfiles.cache` written), cached second load (no request, no `Checksumming`), corrupt and truncated, unknown files, 404 and 500, a cross-origin server without CORS (and with), gzip (on the fly and pre-compressed, with and without a declared size), the picker, quota (hook and Chromium's real quota set to 1 MB over the DevTools protocol: both give the notice) and no IndexedDB, config changes, "Download again" and revalidation, a damaged stored copy, a stalled download, the plain page, the shareware network gate, `grpfiles.cache` kept |
| `node tests/web/con.js` | **17 passed, 0 failed** |
| `node tests/web/determinism.js`, `DET_SEED=1` to `6` | **21 passed, 0 failed**, each (the player of seed 4 was hurt, 63 health, and travelled 78,000 units; the others killed 1 to 5 of the 11 monsters) |
| `DET_STRICT=1` (the known failure counts), 1000-tic recording | 15 passed, 2 failed: "gcc native against wasm, record for record" (D15) and the "at least 1500 tics" check the short recording cannot meet: the strict mode fails as it should |
| brief 02's tests on the same tree: `smoke.js` | **36 passed, 0 failed** |
| `persist.js` | **18 passed, 0 failed** |
| `loops.js` | **18 passed, 0 failed** (with `-testloosecon` passed by the page in test mode: its loose `GAME.CON` still works) |
| `focus.js` | **24 passed, 0 failed** |
| `tests/net/test-single.sh` (native `-testquit`, `-testdump`, demo playback) | PASS |

**Every new check fails without its fix** (sabotage switches: a damaged copy of the page's own code is served by the test server; nothing in the repository changes). `DATA_SABOTAGE=<name> node tests/web/data.js` (183 checks):

| Sabotage | What is damaged | Result |
|---|---|---|
| `nocache` | the cache lookup always misses | 171 passed, **11 failed**: "second load: NO request for the GRP reached the server", "the page says the data comes from the browser", "the game did NOT checksum the GRP again", the same idea in the unchanged-config, ETag, "Download again" and revalidation checks, the damaged-copy check, and `grpfiles.cache` kept |
| `nocrc` | no CRC32 check: `verify()` accepts anything and `identify()` knows every file | 153 passed, **29 failed**: corrupt, random and text files accepted, handed to the game and cached |
| `nosize` | no size checks while downloading | 179 passed, **3 failed**: "truncated (short file)", "text file (default config)", "config change (declared size)" |
| `nocheck` | both of the above | 143 passed, **39 failed** |
| `nopickcache` | the picked file is not stored | **4 failed**, then the run stops (it cannot go on without the file): "the picked file is cached under its own key", "reload starts from the cached local copy", "no request for the GRP reached the server", "the page offers Click to start" |
| `nomtime` | no `FS.utime`: the file gets a new modification time on every load | 179 passed, **3 failed**: "second load: the game did NOT checksum the GRP again", "picker, reload: the game did not checksum it again", "cache kept: the next start did not checksum" |
| `trusthit` | `intact()` always true | 176 passed, **6 failed** (the damaged stored and picked copies are used; the picked one reaches the game) |
| `nostall` | no stall timer | 174 passed, **2 failed** (the page stays at "1.0 MB of 10.5 MB (9%)", no error, no retry) |
| `netaddr` | `?allowsharewarenet=1` (or `allowSharewareNetGames=true`) in the address turns the gate on | 179 passed, **3 failed**: the plain page and the test-mode page with those parameters, and the test-mode argument order |
| `nonetflag` | `config.js`'s `allowSharewareNetGames: true` is not passed on | 180 passed, **2 failed**: the plain page and the test-mode page get no `-allowsharewarenet` |
| `nocachesync` | `grpfiles.cache` is not synced on its own (what jfSW's page does) | 179 passed, **4 failed**: "first load: the game's folder was written to IndexedDB although the player only reached the menu", "second load: the game did NOT checksum the GRP again", the picker's reload, and "cache kept" |

`CON_SABOTAGE=<name> node tests/web/con.js` (17 checks): `pageargs` (the plain page passes `-testloosecon` too): **3 failed** (the game compiled the loose scripts, the page passed the argument, the visitor's game got an argument from nowhere); `pagefiles` (`?files=` honoured outside test mode, the guard removed): **1 failed** ("a visitor's address with ?files=: ready, and no loose script was written"). **The game's side**, by a wasm build whose `CONFROMGRPONLY` is plain `loadfromgrouponly` (the game as it was; built into another directory, `WASM_DIR=<dir> node tests/web/con.js`, then the tree rebuilt): **4 failed**: a visitor's game compiled the loose scripts, the same in test mode without `-testloosecon`, and `-xother.con` compiled a script that is not in the GRP. The mutation of the determinism test is in its section above.

**Differences from jfSW's brief 03** (the files are jfSW's with these changes)

- The table in `web/grptable.js` has Duke's seven entries (no `addon` field: Duke has no add-on entry); `playable()` accepts `DUKE` and `DUKESW`, so the registered releases, the 20th Anniversary release and the Mac shareware GRP start the game; **NAM is recognised and refused** ("cannot be started on its own yet": the page would have to pass `-nam`, untested). Messages say "Duke Nukem 3D".
- The cache database is `jfduke3d-data` (jfSW's is `jfsw-data`); that alone does not let both games share an origin. (The game's own IDBFS database is named after its mount point, `/persist`, in both games and would be shared by two games on one origin; not changed here: out of scope, and brief 06's deployment guide should say "one origin per game".)
- `grpfiles.cache` reaches IndexedDB on its own (`cacheChanged()` in `jfduke3d.js`). jfSW relies on `sw.cfg` being written at every start, which syncs the whole folder; Duke writes `duke3d.cfg` only when the menu is left or the game ends, so a first visit that only reached the menu kept nothing and the next visit checksummed the GRP again. Found by a sabotage run (`nocachesync`, below) that left the first start with no write at all. `data.js` section 14 checks it with a cfg already in place (so that no start-up path rewrites it).
- `config.js` has `allowSharewareNetGames` (D14).
- CON scripts from the GRP only, `-testloosecon`, `?loosecon=0`, `window.jfswArgs` (set in every mode: not a hook, the network-gate test reads it on a plain page).
- `data.js` (test): the main menu is recognised by its cursor (`cursorFinder`, now in `lib.js`) and not by a non-blank picture; the keys that skip the intro are letter keys (§16.4); sizes of the truncated and cut files are for an 11 MB file; the gzip tests send smaller chunks so that the progress bar is sampled enough times.
- `determinism.js` is a different test from jfSW's (their demo is committed and compared against a committed `.dms`; Duke has neither): see above. It checks no frame-time threshold.
- **`?data=` outside test mode takes only a URL on the page's own origin** (resolved against the address); another is ignored with a console warning, so a link cannot make a visitor's page fetch a game from elsewhere. In test mode any URL is taken (the CORS tests need one). **jfSW's page should get the same change as a follow-up**; jfsw-browser was not touched.
- A load that was cancelled (the picker) writes nothing to the cache, and a load that finishes preparing after another started no longer sets 'ready' (fix round of this brief: two races); a revalidation whose answer is cut off or stalls falls back to the kept copy like one that could not connect (a wrong file still shows its error).
- `data-hosting.md` has no 05b or deployment-guide text (those briefs are not written); the Apache blocks are jfSW's with the names changed and were **not run again** here.

**Decisions I took on my own**

1. **The known-failure treatment of "gcc native against wasm"** (above), instead of a red test or a shortened comparison.
2. **A clang native build as the reference of the main comparison**, built by a script from an rsync copy of the tree (so the tree's own gcc objects are untouched) and cached in `~/.cache`.
3. **`-testloosecon` as the way test mode lifts the GRP-only rule**, plus `?loosecon=0` so that the game's rule can be tested on its own. The alternative (a build flag) would have needed a second wasm build for `loops.js`.
4. **`grpfiles.cache` syncs when its text changes**, not only with the cfg.
5. **NAM refused** in the page (recognised in the table, not offered).
6. **D15 and D16 in a separate section of `bugs.md`** (the parallel brief appends D5 to D14 to the first table; both would have appended at the same place).
7. **The page's `window.jfswArgs` is set in every mode.**
8. **Hosting doc:** no Apache run (none installed), so the doc says so.

**Concerns and open questions**

- **D15 is the big one**: native (gcc) and browser players desync in any game where scrap, glass, gibs or bubbles are made. It needs its own brief before brief 04's games can mix native and browser players (and a decision about the evaluation order). Everything else the test covers agrees.
- What the determinism test does not reach: the end of a level and the next level (A1's `-testexit`), more than one player, deaths and respawns, the other weapons and enemies of E2 to E4 (not in the shareware GRP), a long game. `DET_TICS` makes the recording longer (about 70 s of recording per 2000 tics).
- `determinism.js` takes about 10 minutes (recording 70 s, four playbacks of 80 s to 90 s two at a time, the nudge run, and the browser-recorded part); it needs `clang`, `rsync` (without them: NOT RUN, exit 3), `cc` with the SDL2 headers and the native `./duke3d`.
- Firefox and a real network were not tried (as in jfSW's Outcome: storing 11 MB in IndexedDB, the persistent-storage prompt, `FS.utime`, the picker's `accept`, a private window).
- The IDBFS name clash for two games on one origin (above).
- `-x` of a missing script crashes (D16), natively too: harmless for visitors (the page passes no `-x`), noted.

**Findings**

- **D15** (above) is the main one: a real native-against-browser difference, and it was not on A1's list. **D16:** `-x` of a missing script crashes (SIGFPE natively, a trap in the browser).
- **A first visit that only reaches the menu wrote nothing to IndexedDB** with jfSW's page code (sabotage `nocachesync`: no write at all in the first start), so the next visit checksummed the GRP again. `code-facts.md` §16.8 said `duke3d.cfg` is also written when the music cannot start; in these runs nothing wrote it during a first start. Fixed in the page (`cacheChanged()`); the brief's "no re-checksum on reload" holds for Duke only with it.
- **The includes of `GAME.CON` are looked up by the name in the script** (`DEFS.CON`, `USER.CON` in capitals) in a case sensitive file system: a loose copy must be named like that. My first version of `con.js` named them in lower case, so its "loose scripts are read in test mode" check passed for `GAME.CON` only; it checks all three now.
- **The shareware CON's one warning** (§6.3) no longer reaches the "Use default CONs instead?" box in the browser (the macro replaces the `loadfromgrouponly == 0` tests); the 02 build did reach that code, and what `wm_ynbox` did there in a browser was not looked at.
- A recording game's `-testdump` differs from its playback's from tic 1 (D2): the test compares playbacks only, as `tests/net/test-single.sh` does.
- Frame time: not measured here beyond the info line of `determinism.js` (median 17 to 19 ms, a few stalls on a loaded machine, as in 02).

**Commits** (branch `browser/03-data-download`, from `claude` `605a877`): `de3d4e1` CON scripts from the GRP only (`gamedef.c`, `game.c`); `3039896` the page, `data.js`, `grptable.js`, `config.js`; `70c5e3c` the tests; `29474d7` test and comment fixes; `45e9501` the docs; the merge of `claude` (A1) `29f7b34`; `6665919` a blank line. No fork, vnet or `PROMPT.md` change.

**Play-test steps for the user (Arch, pacman)**

```
sudo pacman -S --needed base-devel git unzip python nodejs npm
git clone --recurse-submodules -b browser/03-data-download https://github.com/VenKamikaze/jfduke3d-browser    # after the merge: -b claude
cd jfduke3d-browser
scripts/setup-emsdk.sh && scripts/build-wasm.sh && scripts/fetch-test-data.sh
mkdir -p /tmp/dukesite && cp build-wasm/* /tmp/dukesite/ && cp testdata/duke3dshare.grp /tmp/dukesite/
cd /tmp/dukesite && python3 -m http.server 8000 --bind 127.0.0.1
```

Use Chromium (or Chrome) and Firefox in turn; for each, a fresh profile or a private window for step 1 (in Chrome DevTools, Application, Storage, "Clear site data" resets the page between steps; in Firefox, Settings, Privacy, Manage Data).

1. **First load.** Open `http://127.0.0.1:8000/`. You should see "Downloading the game data: x MB of 10.5 MB (n%)" with a bar moving to 100 %, then "Ready." and "Game data: Shareware Version, downloaded just now from 127.0.0.1:8000/duke3dshare.grp (10.5 MB). It is kept in this browser." (Firefox may ask for permission to store data persistently; say which you chose.) Click "Click to start": the 3D Realms screen, the title, the main menu.
2. **Reload.** Press F5. The page is ready within a second with no bar, and the line says "downloaded <date> ... kept in this browser". In the terminal running `http.server` no new `GET /duke3dshare.grp` line appears. Start the game: the DevTools console shows `Scanning for GRP files...` and `GRP file: duke3d.grp` but no `Checksumming duke3d.grp`.
3. **Download again.** On the start screen press "Download again": the bar runs again and `http.server` logs one more `GET /duke3dshare.grp`.
4. **A bad URL.** Open `http://127.0.0.1:8000/?data=/nothere.grp`: the page says the URL answered 404, that the game has not been started, and offers "Try again" and "Use your own copy...". Then, for a cross-origin or unreachable server, set `data.url` in `/tmp/dukesite/config.js` to `http://127.0.0.1:8001/duke3dshare.grp` and reload, with nothing listening, or with a second `python3 -m http.server 8001 --bind 127.0.0.1` in a directory holding the GRP (it sends no CORS headers): the message mentions Access-Control-Allow-Origin and the network failure. (A `?data=` on another origin is ignored outside test mode, with a console warning; try `?data=http://127.0.0.1:8001/duke3dshare.grp` to see that.) A cut-off and a damaged file: `head -c 6000000 duke3dshare.grp > /tmp/dukesite/short.grp` and `?data=/short.grp` ("looks cut off ... 6,000,000 bytes"); `cp duke3dshare.grp bad.grp; printf 'X' | dd of=bad.grp bs=1 seek=1000000 conv=notrunc` and `?data=/bad.grp` ("damaged"). Nothing may be remembered after these (DevTools, Application, IndexedDB, `jfduke3d-data`: no new row).
5. **File picker.** Open `?data=/nothere.grp`, press "Use your own copy of the game data...", choose `testdata/duke3dshare.grp` (a registered `duke3d.grp`, if you own it, also works: it is checked against the known versions, 1.3d, 1.4, 1.5, the 20th Anniversary). The page says "your own copy"; start and play. Reload that address: it starts again with no picking and no request. "Use the download instead" goes back.
6. **CON scripts.** Nothing to see by design: a loose `GAME.CON` is ignored in the browser. (To see it, `node tests/web/con.js`.)
7. **The shareware network gate.** Not visible until brief 04: with `allowSharewareNetGames: false` (the shipped `config.js`) the game is started with no arguments; setting it to `true` in `build-wasm/config.js` and reloading starts it with `-allowsharewarenet` (DevTools console: `window.jfswArgs` after the click is `["-allowsharewarenet"]`; it is also what `?allowsharewarenet=1` in the address does **not** do).
8. **Things only a person can see:** the layout on a narrow window (390 px wide looked right in a screenshot, the title touches the top edge as in jfSW's page); whether the picker button works by keyboard (Tab, Enter); the wording of each message; a private window in Firefox (the game starts, a notice says the data is downloaded each time); Slow 3G in DevTools (the bar moves smoothly); in Chrome, DevTools, Application, Storage, "Simulate custom storage quota" set small, then reload (the quota notice).

To run the tests on your machine: `npm i playwright && npx playwright install chromium`, then `node tests/web/grptable.js`, `node tests/web/data.js` (about 5 minutes), `node tests/web/con.js` (2 minutes), and, with the native build (`make -j4`, after the wasm build), `node tests/web/determinism.js` (about 10 minutes; needs `clang`, `rsync`, a C compiler with the SDL2 headers).

**Fix round (review)**

1. `determinism.js`: the browser-recorded demo's gcc-native-against-wasm difference is a known failure only where gcc-native and clang-native also differ (same tic and parts), as in the main comparison; without clang or rsync the test prints NOT RUN and exits 3 (the sprites-only fallback and `DET_CLANG` are gone); the header says that after D15's first difference gcc-against-wasm says nothing more and that clang-native against wasm is the strict check. Run: **22 passed, 0 failed**.
2. Two races. `web/data.js`: a load whose signal was aborted (the picker) no longer does its `cache.put` or `setMeta('source')`. `web/jfduke3d.js`: `dataReady()` re-checks `mine === gen` after `finishPrepare()` (and `finishPrepare()` runs once, memoised), so a stale load cannot set 'ready' or show Start. New `data.js` section 15 checks both.
3. With `revalidate: true` a `truncated` answer (cut off or stalled) falls back to the kept copy like `network`; `corrupt` and `size` still fail (comment in `data.js`; checked in section 15).
4. The `data.js` header no longer says the cache name lets both games share an origin.
5. `?data=` outside test mode accepts only a same-origin URL (a console warning otherwise); `data-hosting.md`, the page header and "Differences from jfSW" say so, with jfSW to follow up.

Sabotages for the new checks (`DATA_SABOTAGE`, 193 checks): `nosuperseded` 2 failed (the cancelled load's file is stored, the source changes); `nogen` 1 failed (the stale load sets 'ready'); `truncfall` 1 failed (no fallback on a cut-off answer); `dataany` 3 failed (a cross-origin `?data=` is used). Unsabotaged: `data.js` **193 passed, 0 failed**; `con.js` 17/0; `smoke.js` 36/0; `determinism.js` 22/0; and the NOT RUN path (no clang or rsync on the PATH) exits 3.
