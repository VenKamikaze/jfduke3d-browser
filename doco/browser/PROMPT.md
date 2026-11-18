# Kick-off prompt: Duke Nukem 3D in the browser, with vnet netplay

You are the **coordinator** for a multi-brief project in [`VenKamikaze/jfduke3d-browser`](https://github.com/VenKamikaze/jfduke3d-browser), a fork of [jonof/jfduke3d](https://github.com/jonof/jfduke3d) (JonoF's Duke Nukem 3D port, C, SDL2, Build engine). This file lives at `doco/browser/PROMPT.md` in that repo.

**The goal:** Duke Nukem 3D playable in a browser (Emscripten/WASM), with the game data downloaded from a URL on startup and online multiplayer over [vnet](https://github.com/VenKamikaze/vnet) (`v0.5.0`, MIT, a virtual-UDP library plus a Go relay). Players host or join a game by room code, from the in-game menu or the console. Desktop (native) players can join the same rooms. Joining a game already in progress is **out of scope**.

**This is the second game.** The same project was finished for Shadow Warrior in [`VenKamikaze/jfsw-browser`](https://github.com/VenKamikaze/jfsw-browser) (briefs 00 to 06b, fixes F2 to F4), on the same engine forks. This project repeats it with the same names and structure, so both stay easy to maintain together. **Read jfSW's `doco/browser/` first** (`README.md`, `PROMPT.md`, the Outcomes of briefs 01 to 06b, `deploy.md`, `bugs.md`) and its hand-over write-up [`porting-jfduke3d.md`](https://github.com/VenKamikaze/jfsw-browser/blob/claude/doco/browser/porting-jfduke3d.md): they say what carries over, what has to be redone (the game side: `src/game.c`'s netcode, Duke's menus, the CON scripts) and which bugs and gotchas to expect. The write-up's jfDuke3D facts were unverified; [`code-facts.md`](code-facts.md) replaces them and lists its corrections.

## 0. Where things stand (hand-off; keep this up to date after every merge)

**18 Nov 2026: briefs 00, 01, 02, F-D1, A1 and 03 have landed on `claude` (A1 `64bb15f`, 03 `88bd65b`, each after an independent review and a fix round). Paused for the user. Open before 04: **D15** (gcc and clang evaluate several `krand()` calls passed as arguments of one call in opposite orders, so gcc-native and wasm games desync; needs an F-brief that picks one order, gcc's keeps today's native games) and **D3** (F4 freezes the game, native too). Read the Outcomes of `A1-determinism-audit.md` (D5, D6 fixed; D7 to D12 recorded; drawing-state catalogue for 04) and `03-data-download.md` (fix-round section; `?data=` same-origin only outside test mode, a follow-up for jfSW).**

- **Landed since 00 (read `01-native-relay.md` and `02-emscripten-port.md`, Outcomes):**
  - **01:** native relay games and plain UDP, test hooks (`-testquit`, `-testsync`, `-testnudge`, `-testdump`), `make test`, `test-net`. **`-testdump`** is 32 bytes per tic: eight little endian words (tic, random seed, six FNV-1a hashes: players, sprites, hittype, sectors, walls, other), state before the tic (`code-facts.md` 15.2). **The shareware network gate (D14):** off by default; `AllowSharewareNetGames = 1` under `[Comm Setup]` in `duke3d.cfg` or `-allowsharewarenet` turns it on; `NetGameAllowed()` decides on the data actually mounted. **D1 (packet 6 re-sent to the wrong slaves with 3 or more players) is fixed by F-D1** (`doco/browser/F-D1-player-announce.md`): the fix is `fix/net-player-announce` (commit `2ae8fc5`, one commit from upstream `master` `55c5f95`, which is still upstream's `HEAD`; it cherry-picks onto it cleanly, nothing sent upstream), the integration branch is `browser/F-D1-player-announce`; `-testdump` hashes `aim_mode`, `auto_aim`, `weaponswitch`, `ud.wchoice` and the name again, and `tests/net/test-player-announce.sh` (in `make test-net`) uses a different configuration for each of 3 and 4 players. **L18 (a vanished host is not noticed) is shared with jfSW** and stays a documented limitation.
  - **02:** `scripts/build-wasm.sh` builds `build-wasm/`; `make test-web` runs `smoke`, `persist`, `focus`, `loops`, `frametime` (the last fails here on 100 ms stalls: software-rendered Chromium). **No Duke loop needed a yield** (the engine's `handleevents()` and `nextpage()` already yield). The page (`web/jfduke3d.js`) is jfSW's 02c page with the same `Module.jfsw*` / `window.jfsw*` names; the data download (03), lobby (05) and notice (05b) are left out. Duke's own bugs: **D3** F4 freezes the game in an undrawn menu (native too), **D4** menu hotkeys move the cursor only. Only game change: `menus()` writes `duke3d.cfg` when the menu closes. The browser links the real vnet-backed `mmulti.c`; no `-DJFBUILD_NO_VNET` switch (decision). **The native-against-wasm determinism test is deferred into brief 03** (it needs 01's `-testdump`). **jfSW's `warpScript()` does not speed up the game** (SDL reads `Date.now`, not `performance.now`): jfSW's test helper could take the same fix.
- **Answers** are recorded in [`README.md`](README.md): submodules on the user's forks; shareware data from a verified mirror; "Start now" is in; music later; upstream-friendly where cheap; the browser offers the shareware GRP plus the file picker only; **CON scripts come from the GRP only** in the browser (a loose CON is test-only, like jfSW's `?files=`) and the CON hash goes into brief 05b's identity; the page files are `jfduke3d.js` and `jfduke3d.css`.
- **Repos:** `VenKamikaze/jfduke3d-browser` (this one; `claude` = upstream `master` `55c5f95`) and the shared forks `VenKamikaze/jfbuild` (`claude`, pinned at `5950d14`), `VenKamikaze/jfaudiolib` (`claude`, `ff1b31d`), `VenKamikaze/jfmact` (`master`, `731c0cc`; it has no `claude`, see the README), plus vnet at `ext/vnet` (`v0.5.0`, `8572c74`).
- **Multi-repo git rules** are in the README ("Working across repos"). The forks are **shared with jfSW**: run both games' `make test` before moving a fork's `claude`, and put a Duke-only engine change behind a run-time switch or in the game.
- **Brief 00 landed:** submodules on the forks at the pins above, `scripts/setup.sh`, `setup-emsdk.sh` (Emscripten 6.0.13; default install `~/.cache/jfduke3d-browser/emsdk`, `EMSDK_DIR` overrides it, and the revision matches jfSW's so one install can serve both), `fetch-test-data.sh`, `run-headless.sh`, the tests of those scripts and a minimal `make test`, the orphan branch `emscripten-ports` (jfSW's, copied as it is), and the verified [`code-facts.md`](code-facts.md) and [`building.md`](building.md). The native build is green on the new pins with **no change to the game**. The Outcome of [`00-setup.md`](00-setup.md) has the details, the test data's source and checksums, and the shareware licence's wording.
- **Test data:** `scripts/fetch-test-data.sh` downloads Duke Nukem 3D 1.3D shareware. Two releases of `3dduke13.zip` exist (`image.dosgamesarchive.com`, MD5 `29b2f40990069d9cb0dbaf0f811d1118`; `archive.org`, MD5 `04e4ca70b8a2d59ed56c451c5c1d5d39`); both hold the same `DUKE3D.GRP` (CRC32 `0x983AD923`, 11,035,779 bytes). `web.archive.org` resets connections from the cloud container.
- **What is different from jfSW, found in brief 00** (details in `code-facts.md`):
  - There is no `net.c`/`sync.c`/`demo.c`: the netcode and the demo code are in `src/game.c`; the main loop is inline in `app_main`.
  - The game tic is **30 Hz** (`TICSPERFRAME` is 4), not 40.
  - `networkmode` comes only from the `-net` arguments (M/S for `-nm`, a bare host, the startup window and any relay game; peer-to-peer only with 2 players). **Every machine compares** the sync byte, but the byte is one per 8 tics, covers only positions and the random seed, and the out-of-sync message is **on the screen only** (no log line).
  - **Nothing in the game exits by itself**: demos loop, SIGTERM is the Escape key. Every headless run ends with a timeout. Brief 01's `-testquit` is needed for scripted runs.
  - The **level-exit code has the same shape as jfSW's L20** (`moveloop` never looks at `MODE_EOL`); not yet tested. Brief A1.
  - **CON scripts are part of the game data** and a loose one overrides the GRP's by default; the version byte covers only the CON flavour (Atomic or not).
  - The engine's browser hooks are named `Module.jfsw*`; the Duke page must provide them under those names (or the fork is changed for both games).
  - The shareware GRP caps a network game at 4 players (an exit after start-up), and quitting the shareware game shows order screens that wait for keys.
  - jfSW's `-net` pass-through gotcha (L1) does not exist here: the game's own option parser skips the `-net` arguments (a `--` ends them).
- **Open for the coordinator:** see "Open questions" in `00-setup.md`'s Outcome (the licence's wording on multiplayer services; the `Module.jfsw*` names; whether Duke's own bug numbers should be `D1…` as `bugs.md` proposes).
- **After moving a submodule pointer, run `make veryclean && make -j4`:** top-level `make` reuses a stale `jfbuild/libengine.a` (jfSW's `bugs.md` L9).

## 1. Set up

1. **The `claude` branch exists** (`55c5f95`, upstream `master`). All work branches from it. Never commit directly to `claude` or `master`.
2. **Run the briefs in order** (§5). Briefs 00 and 01 are done; 02 waits for the coordinator's check.
3. **Network check:** confirm that github.com, proxy.golang.org (for the relay), the emsdk download hosts and `image.dosgamesarchive.com`/`archive.org` are reachable from the session. If a host is blocked, tell the user which one; don't work around it (the GitHub archive URLs are the known exception: `emscripten-ports`).

## 2. What the code does

Verified in brief 00: see [`code-facts.md`](code-facts.md), with file:line for every fact. Read it before writing any brief. The hand-over write-up's claims that the code contradicts are listed in its §13.

## 3. Settled decisions

Don't reopen these inside a brief. If one proves wrong, stop and ask the user. (The same list, with D13 and D14, is in [`README.md`](README.md).)

- **D1. The browser is the end goal.** The native Linux build must keep working, and native players must be able to join browser rooms.
- **D2. No joining mid-game.** The player count is fixed when the game starts.
- **D3. "Join" and "Host" restart into a network game.** In the browser: reload the page with `?join=CODE` (or `?host=N`). Natively: re-launch itself with the equivalent arguments. `main` parses them as it parses `-net` today. Nothing is torn down in-process.
- **D4. The transport is vnet `v0.5.0`** as a git submodule at `ext/vnet`, from the start. `VNET_BACKEND_RELAY_AUTO`; `mmulti.h` unchanged; plain UDP stays for native builds.
- **D5. Relay games use master/slave mode.** The room creator is player 0, the master. Peer-to-peer over the relay is out of scope.
- **D6. The software renderer comes first.**
- **D7. The blocking loops stay.** ASYNCIFY with a yield in the event or frame pump.
- **D8. The page fetches the data** (config URL, `?data=`, progress, IndexedDB cache, the file picker, the game's own GRP detection unchanged). **The browser offers the shareware GRP plus the file picker only. CON scripts come from the GRP only**: the page never writes a loose CON; a loose CON is test-only. Brief 05b hashes the compiled CON script into the data identity.
- **D9. The browser lobby is an HTML overlay.**
- **D10. Git:** feature branches from `claude`, `--no-ff` merges, no pull requests unless asked, no force-pushes, no game data in commits.
- **D11. Licensing:** only the shareware GRP may be offered for public download by default.
- **D12. Toolchain:** Emscripten 6.0.13.
- **D13. File names:** `jfduke3d.js`, `jfduke3d.css`, jfSW's `web/` structure.
- **D14. Shareware network gate:** with the shareware GRP, network games (plain UDP and relay) are refused by default, with a message, unless `[Comm Setup] AllowSharewareNetGames = 1` in `duke3d.cfg` or `-allowsharewarenet` allows them; registered data always allows them. Reason: the shareware licence's `[3][D]` (online multiplayer services need 3D Realms' written permission), so shareware netplay is for LANs only. Tests on shareware data turn the option on. Every entry point asks `NetGameAllowed()`.
- **The forks are shared with jfSW** (README, "Working across repos").
- **Relay games are master/slave** (D5): Duke's M/S code is the `!networkmode` paths of `game.c` (`code-facts.md` §3.1).

## 4. Answers to the open questions

Recorded in [`README.md`](README.md): Q1 (submodules on the forks), Q2 (shareware data from a verified mirror), Q3 ("Start now": yes), Q4 (music later), Q5 (upstream-friendly where cheap), the data offered in the browser, CON from the GRP only, the page file names.

## 5. The briefs

Write each brief as `doco/browser/NN-short-name.md`, in jfSW's format: Goal, Read first, In scope, Out of scope, Acceptance criteria, Tests, Dependencies, Notes, and an empty **Outcome**. Keep the status table in `doco/browser/README.md`. Copy jfSW's brief for the same number and adapt it; what changes is the game side. Sizes relative to jfSW's, if the engine forks are reused: 01 about half, 02 about two thirds, 03 small, 04 about two thirds, 05 about two thirds, 06 small.

| # | Brief | Depends on | Can run alongside |
|---|---|---|---|
| 00 | Set-up, baseline, code facts | — | |
| 01 | Native relay games, test hooks, `make test-net` | 00 | 02 |
| 02 | Emscripten port | 00 | 01 |
| A1 | Determinism audit and level-exit test | 01 | |
| 03 | Data download | 02 | |
| 04 | Browser netplay, hidden-tab pass, drawing-state audit | 01, 02, 03, A1 | |
| 04b | Lag cuts | 04 | |
| 05 | Host and join | 04b | |
| 05b | Data and build warning | 05 | |
| 06 | Deployment guide | 05b | |

Later, not briefed: music (Q4), WebGL, touch controls, the Atomic Edition, NAM and other GRPs in the browser, mouse turns drawn between tics, smoothing prediction corrections.

**00, set-up.** Done (see `00-setup.md`).

**01, native relay games and test hooks.**
- The engine side is in the jfbuild fork already: `-net -relay HOST:PORT -host-room N` creates a room, `-net -relay HOST:PORT -room CODE` joins one (`code-facts.md` §10). Check it from Duke first; the game's `-net` pass-through should already work.
- Add the **test-only hooks** to `src/game.c` (jfSW's `sync.c` has the originals): `-testquit<N>` (stop after N tics, exit 0: nothing else ends a run), `-testsync` (log the sync byte and **log the out-of-sync message**, which the game only draws), `-testnudge<T>`, and **`-testdump<name>`: a per-tic state hash of every machine** over `ps[]`, `sprite[]`, `sector[]`, `wall[]` (as far as the simulation writes them), `hittype[]`, `randomseed` and the CON state. Every later brief's determinism test depends on it; Duke's own sync byte is too weak to trust (`code-facts.md` §2.5).
- `make test-net`: three native game processes (relay and plain UDP) playing a level through a local Go relay with no desync, plain UDP against a baseline build, error states. Prove each test fails without the change.
- Hosting is limited to 4 players on the shareware GRP.

**02, Emscripten port.**
- A wasm build target (`Makefile.emscripten`, `scripts/build-wasm.sh`, output in `build-wasm/`), ASYNCIFY with the yields in Duke's own blocking loops (`code-facts.md` §4: `waitforeverybody`, the network wait, `Logo`, `playanm`, `userack`, `dobonus`, `fadepal`/`palto`, the shareware order screens and the exit wait; the engine's `handleevents()`/`showframe()` already yield). The shell page in `web/` is jfSW's with the names changed; it must provide the `Module.jfsw*` hooks the engine calls.
- Config and saves on IndexedDB, start on a click, dev knobs behind `?test=1` and `testMode: true`.
- **Tests:** Playwright (Chromium and Playwright are preinstalled; never run `playwright install`): reach the menu, a level with a non-blank canvas, a recorded demo played natively and in wasm with identical per-tic hashes (using 01's `-testdump`), frame time (that check fails in the container, software rendering).
- Run 01 and 02 in parallel in separate worktrees and share one emsdk install.

**A1, determinism audit.** Read-only code audit with tests, as `code-facts.md` §7 starts it: sound-gated random numbers and state (`isspritemakingsound`/`issoundplaying` guards in `actors.c`, `sector.c`, `gamedef.c`); local-player state in simulation code (`myconnectindex`, `screenpeek`, `ud.` fields set from menus or the config: `ud.lockout` at `premap.c:967`, the `actors_killed` counters, the ambient-sound sprites' `T1/T2/T5`); the CON VM; prediction purity (hash the whole state before and after `fakedomovethings`); the aim mode (`auto_aim`, `weaponswitch` are announced once); and **a level-exit test with the jfSW F3 pattern** (a host that holds the inputs of later tics at the exit) for the `moveloop` problem (`code-facts.md` §5). Fixes go on `fix/…` branches from `master`.

**03, data download.** jfSW's `web/data.js`, the IndexedDB cache, the file picker and `grptable.js`, rebuilt from `src/grpscan.c` (seven entries; the shareware one is the default). **CON from the GRP only**: no loose CON is written, and the test checks that a page-supplied folder never holds one. Document the server side as jfSW's `data-hosting.md` does.

**04, browser netplay.** 01's transport in the wasm build; the **hidden-tab pass** for Duke's `faketimerhandler`/`getpackets`/`moveloop` (jfSW's `HiddenNetPass`: make the inputs due, move, flush) at Duke's 30 tics a second; cross-play native and browser. **Drawing-state audit** (jfSW's 04c, L19) in the same brief: what `displayrooms()` (`game.c:2906`), `animatesprites()` (`:5160`), mirrors, camera sprites (`animatecamsprite`, `sector.c:383`) and `drawbackground()` write to `sprite[]`, `sector[]`, `wall[]`, `hittype[]` and `ps[]`, given that a hidden tab draws nothing. Tests: two browsers, a browser plus a native process, WebTransport and WebSocket, impairment, a hidden tab, a full level with no hash difference.

**04b, lag cuts.** jfSW's: send each input as soon as it is made, and have the master forward a tic as soon as the last input arrives, in Duke's `faketimerhandler()` and `getpackets()` (`code-facts.md` §2.3 notes that the master forwards at its own timer tick). Measure first; prove with `-testdump` agreement.

**05, host and join.** `?host=N`/`?join=CODE`, the lobby overlay (jfSW's `mmulti_vnet.h` API), Start now, and the Duke side: console commands `host`/`join`/`relay` in `osdcmds.c` (`changelevel`/`map` out of a game start a single-player game today, `code-facts.md` §8), Host Online and Join Online in the menus (`menues.c`, menu 600 is the network setup), the native re-launch, the GTK startup window's fields (`startgtk_game.c`), and the **hidden-tab `dobonus`** (the frag screen waits for a key on every machine: `code-facts.md` §4). Every error state ends with a sentence. Player cap 4 on shareware.

**05b, data and build warning.** Each machine sends its data identity (GRP CRC32 and size, edition, **a hash of the compiled CON script**) and a build id (`scripts/build-id.sh`) once per session; every player is told when they differ. Duke's `BYTEVERSION` check at packet 6 (`game.c:642`) is an exit; this is the friendlier layer next to it. Keep start-up packets small (mmulti packs about 214 bytes into a datagram).

**06, deployment guide.** jfSW's `deploy.md` and `tests/deploy/check-deploy.sh` with Duke's names and paths. **Use placeholder host names and paths only** (`game.example.org`, `/srv/http/games/duke3d`). Include the shareware licence's conditions (`00-setup.md`, Outcome, "Licence").

## 6. Running each brief (the user's standard process)

1. **Branch** from `claude`: `browser/NN-short-name`.
2. **Implementer:** a subagent on the strongest available model. Give it:
   - the brief path, the repo and the branch;
   - "read `doco/browser/README.md`, `code-facts.md`, the brief and the Outcomes of its dependencies first";
   - the commit trailer lines this session's system reminder specifies;
   - "commit at each milestone and push the feature branch (only that branch) after each commit; never merge, never touch `claude`, never open a PR";
   - `-j4` builds (the container has 4 cores).

   Ask it to report: commit hashes, what changed, test results with counts, proof that the new tests fail without the change, and any concerns.
3. **Review:** a read-only subagent in its own `git worktree`. It checks the acceptance criteria, correctness, determinism (native against wasm, and every machine in a room), that the tests really fail without the change, and the untested glue. Findings are ranked blocking, should-fix or nit, each with file:line and a failure scenario, followed by a verdict. Give it the brief and the diff command, not your conclusions.
4. **Fix round:** send the worthwhile findings back to the **same** implementer. Re-review whenever a fix changes behaviour. **If a brief still needs work after its fix round, spawn a new implementer on the strongest model** rather than going round again with the same one (the user, 12 Nov 2026, for jfSW).
5. **Verify yourself:** rebuild, run every test, read the fix diff. **If a brief changes a shared fork, run jfSW's `make test` too** before moving the fork's `claude`.
6. **Merge:** `git merge --no-ff` into `claude` (check for conflict markers before committing anything after it), then push `claude` and the feature branch.
7. **Record:** the status in the README table, the brief's Outcome filled in, and exact play-test steps for the user when a brief needs one (`done (play-test pending)`).
8. **Report** to the user in a few lines: what landed, the numbers, anything pending, and what's next. Keep §0 up to date after every merge, so a fresh session can carry on.

## 7. Rules and lessons

From Bit Riot and jfSW; the full list with the reasons is in jfSW's `porting-jfduke3d.md` §7.

- **Tests:** never skip, loosen or quarantine one to get to green. Require mutations: each new test must fail without its fix.
- **Network denials:** report a blocked host to the user; don't work around it.
- **A wrong brief:** if a brief is wrong about the code, fix the brief and `code-facts.md` in the same branch, and say so.
- **Pushing:** push after every milestone; the container can restart and kill background work.
- **Reviews find real bugs** even when every test passes, mostly in untested glue.
- **Don't change the game's simulation** except where a brief needs it, and run the determinism checks after any change.
- **Environment:** Chromium and Playwright are preinstalled; GitHub archive URLs answer 403; run one heavy test suite at a time; `scripts/build-wasm.sh veryclean` also deletes the native binary; headless Chromium renders in software, so the frame-stall check fails there and must not be loosened.
- **The page:** test hooks need `?test=1` and `testMode: true` in `config.js`; the relay comes only from `config.js`; Emscripten drops the promises of pointer-lock, fullscreen and `AudioContext.resume()` (the page catches them).
- **Netcode:** a hidden tab keeps stepping through vnet's wake callback and a `MessageChannel`, never `setTimeout`; the relay gives a departed member's address to the next joiner, so places are matched by session id; mmulti packs about 214 bytes into a datagram, so keep start-up packets small; `waitforeverybody()` should flush its ready packet at once.
- **Git hygiene:** use placeholder host names (`game.example.org`) everywhere; never let an agent `rm -rf` a glob in `/tmp`; fix commits for the original game carry no session trailers.
- **The user's preferences:** Java is their main language, they run Arch Linux, they prefer open-source tools, and they like bash and Python for quick scripts. Give Arch commands (`pacman`) in play-test steps.

## 8. Kick-off

Brief 00 is on `browser/00-setup`: review it and merge it into `claude`. Then write and run 01 and 02 in parallel, continue down the table (§5), and report to the user after each merge.
