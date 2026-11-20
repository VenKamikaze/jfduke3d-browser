# Duke Nukem 3D in the browser: work briefs

The goal is Duke Nukem 3D (JFDuke3D) playable in a browser (Emscripten/WASM). The game data is downloaded from a URL on startup, and online multiplayer runs over [vnet](https://github.com/VenKamikaze/vnet) `v0.5.0`. Players host or join by room code, and native desktop players can join the same rooms.

This is the second game of the project. **Shadow Warrior** was done first, in [`VenKamikaze/jfsw-browser`](https://github.com/VenKamikaze/jfsw-browser) (briefs 00 to 06b and fixes F2 to F4, all merged), on the same engine: jfbuild, jfaudiolib and jfmact are shared forks, and this repository copies jfSW's files, names and structure wherever that makes sense so that both games stay easy to maintain together. jfSW's [`doco/browser/porting-jfduke3d.md`](https://github.com/VenKamikaze/jfsw-browser/blob/claude/doco/browser/porting-jfduke3d.md) is the hand-over write-up this project started from (its jfDuke3D facts were unverified; [`code-facts.md`](code-facts.md) replaces them and lists its corrections).

Each brief (`NN-*.md`) is one unit of work, sized for a single implement → review → merge cycle, and written so that a fresh session can pick it up. Only brief 00 is written so far; the others are in the table below and are written when their turn comes.

**Starting a fresh session on this work?** Point it at [`PROMPT.md`](PROMPT.md). Its §0 is the hand-off.

**Reading order:** this file, then the brief, then [`code-facts.md`](code-facts.md) (what the code actually does, with file:line refs), then the **Outcome** sections of every brief yours depends on: they record what actually landed. Commands to build and run: [`building.md`](building.md).

**jfSW's documents are the reference** for everything that is not Duke-specific: its `README.md`, `PROMPT.md`, `code-facts.md` (the netcode of the other game), `deploy.md`, `data-hosting.md` and `bugs.md` (the shared L-numbers).

## Status

| # | Brief | Repos touched | Depends on | Status |
|---|---|---|---|---|
| 00 | [Set-up, baseline, code facts](00-setup.md) | jfduke3d-browser | — | landed |
| 01 | [Native relay games](01-native-relay.md), test hooks (`-testquit`, `-testsync`, `-testnudge`, `-testdump` per-tic state hash), `make test-net` | jfduke3d-browser | 00 | landed (merged `cab7a05`) |
| 02 | [Emscripten port](02-emscripten-port.md): wasm build, page, IDBFS, browser tests (no Duke loop needed a yield) | jfduke3d-browser | 00 (alongside 01) | landed |
| F-D1 | [Fix for 01's D1](F-D1-player-announce.md): packet 6 re-sent to the wrong slaves in master/slave mode with 3 or more players; `-testdump` hashes the announced settings again; `test-player-announce.sh` | jfduke3d-browser | 01 | landed (merged `605a877`; fix `fix/net-player-announce` `2ae8fc5`, cherry-picks onto upstream `master`) |
| F-D3 | [Fix for D3](F-D3-f4-menu.md): F4 opened menu 701, which had no case in `menus()`; the game froze in an undrawn menu (native too). `menu-keys.js`, `test-menu-f4.sh` | jfduke3d-browser | 02 | landed (merged `6a0b1f5`; fix `fix/f4-sound-menu` `0ba42f5`) |
| F-D15 | [Fix for D15](F-D15-krand-order.md): 36 sites with unsequenced `krand()` draws now draw in gcc's order, so gcc-native and wasm games agree; strict `determinism.js`, `krand-order.py` | jfduke3d-browser | 03 | landed (merged, see `git log`; fix `fix/krand-arg-order` `851cc3c`) |
| A1 | [Determinism audit](A1-determinism-audit.md) (sound-gated random, local-player state in simulation, CON VM, prediction purity, aim mode) and a level-exit test (the F3 pattern): **two game-breaking bugs fixed** (D5 extra tics after the level exit, D6 hang at the level exit), the rest in `code-facts.md` §17 and `bugs.md` D7 to D12 | jfduke3d-browser | 01 | landed (merged `64bb15f`); fix branches `fix/level-exit-tics` `e79140d`, `fix/level-exit-forward` `27e9aef` |
| 03 | [Data download](03-data-download.md) (`data.js`, IndexedDB cache, file picker, `grptable.js` from `grpscan.c`; CON from the GRP only; `allowSharewareNetGames`), **and the native-against-wasm determinism test** (found D15: gcc and clang evaluate the arguments of `RANDOMSCRAP` and its kind in opposite orders, so gcc-native and wasm differ; clang-native and wasm are identical) | jfduke3d-browser | 02 | landed (merged `88bd65b`) |
| 04 | [Browser netplay, hidden-tab pass and drawing-state audit](04-browser-netplay.md) (jfSW's 04 and 04c together): browsers and native games in one relay room, `HiddenNetPass()`, `-testdrawcheck`/`-testnodraw`/`-testcam`/`-testmirror`, `tests/web/netplay.js`, `tests/net/test-nodraw.sh`; no fork change; **D11 reproduced and fixed** (`fix/level-exit-stale-inputs` `f67d20a` + `a83effc`: a slave's late input for the level just left was taken for its first input of the next) | jfduke3d-browser | 01, 02, 03, A1 | landed (merged into `claude`) |
| 04b | [Lag cuts](04b-lag-cuts.md) (jfSW's 04b: `-testlag`, each input flushed when made, the master forwards a complete tic at once, the tic-1 check; `-f2`/`-f4` tested; **no fork change**) | jfduke3d-browser | 04 | landed (merge `a387f13`; slaves 33 to 72 ms sooner; datagrams 1.4 to 2.0 times; fix round: no forward inside a barrier, no extra 127 nudge; D19, D20) |
| 05 | [Host and join](05-host-and-join.md) (jfSW's 05 for Duke: `?host=`/`?join=`, the lobby overlay, Start now, HOST ONLINE and JOIN ONLINE in the title menu, console `host`/`join`/`relay`, the GTK startup window, **`NetGoneCheck()`: a vanished host or guest ends the others' game with a message (L18, the rest)**, a hidden tab leaves the deathmatch totals table; **no fork change**) | jfduke3d-browser | 04b | review (branch `browser/05-host-and-join`) |
| 05b | Data and build warning (GRP identity, CON hash, build id) | jfduke3d-browser | 05 | not written |
| 06 | Deployment guide | jfduke3d-browser | 05b | not written |

01 and 02 can run in parallel.

**Fixes to bugs in the original game** (see "Bugs found in the original game" below) get their own `F`-briefs when they are found. So far F-D1 (D1: the player announcement). jfSW's F2 (the ALSA MIDI crash) is already in the jfaudiolib fork's `claude`; jfSW's F3 and F4 were game fixes in jfSW and are not in this game: A1 checks whether Duke has the same problems (`code-facts.md` §5 says the level-exit code has the same shape as L20).

Later, not briefed: music (decision below), WebGL rendering through the GLES2 path, touch controls, the Atomic Edition, NAM and other GRPs in the browser, mouse turns drawn between tics (view angle only), smoothing prediction corrections.

## Settled decisions

Don't reopen these inside a brief. If one proves wrong, stop and ask the user. D1 to D12 are jfSW's, adapted; D13 and D14 are Duke's.

- **D1. The browser is the end goal.** The native Linux build must keep working, and native players must be able to join browser rooms.
- **D2. No joining mid-game.** The player count is fixed when the game starts, as it is today.
- **D3. "Join" and "Host" restart into a network game.** In the browser: reload the page with `?join=CODE` (or `?host=N`). Natively: re-launch itself with the equivalent arguments. `main` parses these exactly as it parses `-net` today (`app_main`, `checkcommandline`; `code-facts.md` §3.2). Nothing is torn down in-process.
- **D4. The transport is vnet `v0.5.0`**, a git submodule at `ext/vnet`, **from the start** (jfSW began on `v0.4.0`). Use `VNET_BACKEND_RELAY_AUTO` (WebTransport then WebSocket in the browser, the relay over UDP natively). `mmulti.h` stays unchanged: a vnet implementation sits behind it, and it is already in the jfbuild fork. Plain UDP (today's `-net`) stays for native builds.
- **D5. Relay games use master/slave mode.** The room creator gets `10.0.0.1`, which is player 0, the master; joiners fill the open slots. Peer-to-peer over the relay is out of scope (mmulti refuses it, and Duke's peer mode only does 2 players anyway: `code-facts.md` §3.1).
- **D6. The software renderer comes first.** WebGL through GLES2 is later.
- **D7. The blocking loops stay.** The browser build uses ASYNCIFY, with a yield in the event or frame pump. No rewrite around `emscripten_set_main_loop`. Duke's loops are listed in `code-facts.md` §4.
- **D8. The page fetches the data.** JavaScript downloads the GRP before `main` (URL from the page config, overridable with `?data=`), shows progress, caches it in IndexedDB, and writes it into a folder on the game's search path, so the game's own GRP detection is unchanged. A file picker covers people with their own copy. No native downloader. **In the browser only the shareware GRP and the file picker are offered**, and **CON scripts come from the GRP only**: the page never writes a loose `GAME.CON`, `USER.CON` or `DEFS.CON` (a loose CON overrides the GRP's, `code-facts.md` §6.3; a loose CON is test-only, like jfSW's `?files=`). Brief 05b puts a hash of the compiled CON script into the data identity.
- **D9. The browser lobby is an HTML overlay** (room code, invite link, who has joined), not drawn by the engine. The console and menu entries lead to it.
- **D10. Git:** feature branches from `claude` and `--no-ff` merges. No pull requests unless the user asks; no force-pushes. GRP files and other game data are never committed.
- **D11. Licensing:** only the shareware GRP may be offered for public download by default. Hosting registered data is the user's call. (The shareware licence's wording on multiplayer services is in `00-setup.md`, Outcome, "Licence"; brief 06 deals with it.)
- **D12. Toolchain:** Emscripten 6.0.13, as Bit Riot and jfSW pin. `scripts/setup-emsdk.sh` is jfSW's, renamed.
- **D13. File names.** The page files are `jfduke3d.js` and `jfduke3d.css`, with jfSW's structure (`web/` with `config.js`, `data.js`, `grptable.js`, `index.html`). The wasm output is `jfduke3d.*`.
- **D14. Shareware network gate (user decision, 18 Nov 2026).** With the shareware GRP, network games are **refused by default**, with a clear message, whether plain UDP or through a relay, unless the player allows them: `[Comm Setup] AllowSharewareNetGames = 1` in `duke3d.cfg` (default 0) or `-allowsharewarenet` on the command line (before `-net`). Registered data (any GRP that is not the shareware one) always allows them. The reason is the shareware licence's `[3][D]` clause on an "online service providing multiplayer use" (`00-setup.md`, Outcome, "Licence"): shareware netplay is meant only for LAN deployments. The tests that run on shareware data turn the option on explicitly. The browser's equivalent (a `config.js` setting that adds the argument) and hiding the menu and console Host/Join entries when it is off are later briefs; every entry point must ask `NetGameAllowed()` (`src/netgame.h`). (Numbered D14 because D13 is the file names.)

## Answers to the open questions (18 Nov 2026)

jfSW's questions Q1 to Q5, answered for Duke:

- **Q1. Submodules: on the user's forks.** `.gitmodules` points at `https://github.com/VenKamikaze/{jfbuild,jfmact,jfaudiolib}.git` with absolute URLs. See "Working across repos".
- **Q2. Test data: the shareware 1.3D release, from a verified mirror.** `scripts/fetch-test-data.sh` downloads `https://image.dosgamesarchive.com/games/3dduke13.zip` (MD5 `29b2f40990069d9cb0dbaf0f811d1118`), falling back to `https://archive.org/download/3dduke13/3dduke13.zip` (a different release of the zip, MD5 `04e4ca70b8a2d59ed56c451c5c1d5d39`), takes `DUKE3D.GRP` out and checks it against `src/grpscan.c`: CRC32 `0x983AD923`, 11,035,779 bytes ("Shareware Version"). Stored as `testdata/duke3dshare.grp`, which is ignored by git. `web.archive.org` resets connections from the cloud container.
  - Neither host sends CORS headers that a page on another origin could use (the same caution as jfSW's Q2): brief 03 serves the data from the game's own origin or a CORS-enabled host.
- **Q3. "Start now": yes.** The host can start with fewer players than the number of slots chosen. Every client must learn the final player count before the game initialises.
- **Q4. Music: later.** Sound effects are in scope; Ogg/MIDI music is an unbriefed follow-up.
- **Q5. Upstream friendliness: yes, where cheap.** Prefer new files, `#ifdef __EMSCRIPTEN__` and no reformatting of upstream code.
- **Which data the browser offers: the shareware GRP plus the file picker only** (D8).
- **CON scripts: from the GRP only in the browser** (D8); brief 05b adds the CON hash to the identity.
- **Page file names:** `jfduke3d.js`, `jfduke3d.css` (D13).

## Working across repos

The work spans four GitHub repos, **three of them shared with jfSW**:

| Repo | Role | `claude` branch |
|---|---|---|
| `VenKamikaze/jfduke3d-browser` | the game, docs, scripts, tests | from `master` `55c5f95` (upstream jfduke3d) |
| `VenKamikaze/jfbuild` (submodule `jfbuild/`) | engine, `mmulti.c`, SDL layer | **shared with jfSW**; pinned at `5950d14` |
| `VenKamikaze/jfaudiolib` (submodule `jfaudiolib/`) | audio | **shared with jfSW**; pinned at `ff1b31d` |
| `VenKamikaze/jfmact` (submodule `jfmact/`) | input and config library | **none**; stays on `master` `731c0cc` (see below) |

vnet is a fourth submodule at `ext/vnet`, pinned to the `v0.5.0` tag (`8572c74`). It is never changed from here.

**Rules:**

1. A brief's branch is `browser/NN-short-name` in jfduke3d-browser, from its `claude`.
2. If the brief changes jfbuild or jfaudiolib, it uses a branch with **the same name** in that fork, from the fork's `claude`. Commit there, push that branch, then commit the new submodule pointer on the jfduke3d-browser branch. Every pointer committed in jfduke3d-browser must be a commit that is pushed to the fork.
3. **Merging:** merge the fork's branch first (`--no-ff` into the fork's `claude`, push). Then, on the jfduke3d-browser feature branch, move the submodule pointer to the fork's new `claude` merge commit, commit, and merge jfduke3d-browser (`--no-ff` into `claude`, push). After the merge, `claude` in jfduke3d-browser always points at commits on the forks' `claude` branches.
4. **The forks are shared with jfSW. Before moving a fork's `claude`, run both games' `make test`** (jfsw-browser's and this one's) against the new commit. jfSW's own submodule pointer does not move by itself, but its next brief starts from the fork's `claude` and must find it passing.
5. **A Duke-only engine change goes behind a run-time switch** (an option or a game callback the other game doesn't set), **or into the game**, never into a fork branch the other game can't use as it is.
6. A fresh `git clone --recurse-submodules -b claude https://github.com/VenKamikaze/jfduke3d-browser` must always work.
7. Changes to engine code stay upstream-friendly (Q5): new files where possible, `#ifdef __EMSCRIPTEN__`, no reformatting.
8. The engine's browser hooks are named `Module.jfsw*` (`code-facts.md` §10). Don't rename them in one game's brief.

**jfmact:** the fork has a stale branch `claude/keen-hamilton-ede0qw` (identical to `master`), and git cannot have a `claude` branch next to it. If a brief needs to change jfmact, ask the user whether that branch can be deleted before creating `claude` there.

**`emscripten-ports`** is an orphan branch of this repository holding the SDL2, Ogg and Vorbis port archives (the same one jfsw-browser has). It is the one exception to "branches come from `claude`". Never force-push it.

## Bugs found in the original game

The user's policy, as for jfSW (6 Nov 2026):

- A bug in the original game (or engine) that **breaks the game** (a freeze, a crash, a lost game), **reproduces reliably**, and is **in something a normal multiplayer game is likely to use** gets its own brief (`Fn-short-name.md`) and its own fix. The project is quick web multiplayer games over vnet, in the browser and natively.
- **A game-breaking bug in a feature a normal multiplayer game is unlikely to use** (demo recording, the editor, single-player-only features, and so on) is out of scope for a brief and fix: note it in `bugs.md` as **not planned**, with the reason, and tell the user. If unsure, ask.
- **Lesser bugs** (wrong messages, cosmetic problems, odd edge cases that don't stop play) go in [`bugs.md`](bugs.md), to look at later. Don't fix them inside an unrelated brief, unless the brief can't work around them; then fix them in the smallest way and say so in `bugs.md`.
- **First, check that upstream hasn't already fixed it.** Compare `jonof/<repo>` `HEAD` with the pinned commit, read the newer commits that touch the code involved, look at upstream's unmerged pull requests, and re-run the reproduction with the submodule moved to the fork's current `master`. If a newer upstream commit fixes it, the fix is to move the pin (its own brief), not a new patch. Record what was checked in the Outcome.
- **A fix is made so that it can go upstream to JonoF unchanged:**
  1. The fix branch, `fix/<short-name>`, starts from **`master`** (upstream jfduke3d, `55c5f95`), not from `claude`, and holds only the fix: upstream code style, no reformatting, no browser or vnet code, no `doco/`, a commit message written for upstream, and **no session trailers on the fix commit** (no `Co-Authored-By`, no `Claude-Session`) so it can go upstream as it is. If the fix is in jfbuild or jfaudiolib, the fix branch is in that fork, from the commit this repository pins, and must also apply cleanly to the fork's current `master` (check with a throwaway rebase or cherry-pick, and say so). A fix in a shared fork also has to leave jfSW's `make test` green (rule 4 above).
  2. An integration branch, `browser/Fn-short-name`, from `claude`, merges the fix branch with `--no-ff` and adds what upstream doesn't want: the regression test, the Outcome, `code-facts.md` and `bugs.md` updates. It is reviewed and merged into `claude` like any brief.
  3. Nothing is sent upstream (no pull request, no issue) unless the user asks.
- A fix changes the simulation, so after it: the committed demos must still replay with identical results (or the brief explains, tic by tic, why a demo legitimately changed), and the native-against-wasm check from 02 must still pass.

## Process

See [`PROMPT.md`](PROMPT.md) §6 and §7: implementer subagent per brief, read-only review in its own worktree, fix round, coordinator verification, `--no-ff` merge, Outcome filled in, hand-off updated.
