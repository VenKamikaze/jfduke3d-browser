# Building and running

Copy-pasteable commands. Written for Ubuntu 24.04 (the cloud container) and Arch Linux (the user's machine). All paths are relative to the repository root.

## 1. Get the source

```sh
git clone --recurse-submodules -b claude https://github.com/VenKamikaze/jfduke3d-browser
cd jfduke3d-browser
git submodule status        # ext/vnet must say 8572c74 (v0.5.0)
```

(Until brief 00 is merged, use `-b browser/00-setup`.) The submodules (`jfbuild`, `jfaudiolib`, `jfmact`, `ext/vnet`) are fetched from the user's forks over absolute URLs, so the clone works from anywhere. Already cloned without `--recurse-submodules`: `git submodule update --init --recursive`.

Pins (see the README, "Working across repos"): jfbuild `5950d14` (the fork's `claude`), jfaudiolib `ff1b31d` (the fork's `claude`), jfmact `731c0cc` (the fork's `master`), vnet `v0.5.0` (`8572c74`). jfSW (`jfsw-browser`) pins the same forks.

## 2. Native dependencies

```sh
scripts/setup.sh              # apt (Ubuntu/Debian) or pacman (Arch), incl. GTK3
scripts/setup.sh --no-gtk     # without the GTK3 startup window
```

It installs: compiler and `make`, `pkg-config`, `git`, `curl`, `unzip`, Python 3, SDL2, libvorbis and libogg, OpenGL headers, ALSA headers, and GTK3. It is idempotent and non-interactive, and uses `sudo` unless run as root. Go is only checked: the vnet relay (`ext/vnet/relay`) needs Go 1.24 or newer (Arch: `sudo pacman -S go`; Ubuntu 24.04's own package is older, so use go.dev's tarball).

By hand, Arch: `sudo pacman -S --needed base-devel pkgconf git curl unzip python sdl2 libvorbis libogg mesa glu alsa-lib gtk3`. (Arch's SDL2 is now `sdl2-compat`; the pacman path of the script is untested.)

## 3. Build

```sh
make -j4                                          # OpenGL + Polymost (default); builds ./duke3d and ./build
make veryclean && make -j4 USE_POLYMOST=0 USE_OPENGL=0   # software renderer only (what the browser uses, D6)
```

Switching renderer settings needs `make veryclean` first (the objects differ). `make veryclean` cleans the submodules too. **After moving a submodule pointer, always `make veryclean && make -j4`**: top-level `make` reuses an existing `jfbuild/libengine.a` (jfSW's `bugs.md` L9). About 20 s on 4 cores. There are 12 compiler warnings (7 with the software renderer) in the existing code; none are in anything the browser work touches (`code-facts.md` §11). Build without GTK: `make WITHOUT_GTK=1 -j4` (after `make veryclean`).

`./duke3d` is the game, `./build` is the map editor. The game's `.c` files are compiled as C (`-std=c99`) and the program is linked with `g++`; the build log therefore shows `g++` for the link.

The jfbuild fork's `claude` is used **unchanged**: no change to the game was needed to build with it (brief 00).

## 4. Test data (Duke Nukem 3D 1.3D shareware)

```sh
scripts/fetch-test-data.sh                  # downloads, verifies, writes testdata/duke3dshare.grp
scripts/fetch-test-data.sh --from-zip /path/to/3dduke13.zip   # use a local copy of the zip
scripts/fetch-test-data.sh --dest DIR       # somewhere other than testdata/
tests/fetch-test-data.sh [A.zip [B.zip]]    # the script's tests (downloads the zips if none are given)
tests/run-headless.sh                       # tests for run-headless.sh (fake game, no data needed)
make test                                   # both of the above
```

`3dduke13.zip` exists in two releases, and the script takes either:

| Source | MD5 of the zip | Contents |
|---|---|---|
| `https://image.dosgamesarchive.com/games/3dduke13.zip` (tried first) | `29b2f40990069d9cb0dbaf0f811d1118` | `INSTALL.EXE`, `DUKE3DS._1` to `_5` (five parts that, joined, are one zip holding the game's files), `DUKE3DS.IFC`, `FILE_ID.DIZ` |
| `https://archive.org/download/3dduke13/3dduke13.zip` | `04e4ca70b8a2d59ed56c451c5c1d5d39` | `INSTALL.EXE`, `LICENSE.TXT`, `DN3DSW13.SHR` (a zip holding the game's files), `FILE_ID.DIZ` |

Both give the same `DUKE3D.GRP`: CRC32 `0x983AD923`, 11,035,779 bytes, the "Shareware Version" entry of `src/grpscan.c`. The script checks the zip's MD5, takes `DUKE3D.GRP` out with Python's `zipfile`, checks its size and CRC32, and only then moves it to `testdata/duke3dshare.grp`. Nothing is left at the destination unless every check passed; a second run does nothing. `testdata/` is git-ignored: game data is never committed. `web.archive.org` resets connections from the cloud container; the two hosts above work.

## 5. Run the game headless

```sh
scripts/run-headless.sh --timeout 10 -v1 -l1        # E1L1 for 10 s, then stopped (exit 124)
```

Options go before the game's arguments: `--grp FILE`, `--timeout SEC` (default 30), `--workdir DIR` (kept afterwards), `--game FILE` (`--sw` is the same option, for jfSW's scripts), `--music`, `--display`. It runs `./duke3d -nosetup …` with `SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy`, `DISPLAY` unset, and `HOME` and the working directory set to a throw-away directory (or `--workdir`) that holds a `user_profiles_disabled` file (the game's own "portable" switch) and a symlink to the GRP, so config, log, `grpfiles.cache` and demos all land there and nothing touches your home. Music is switched off in that directory's `duke3d.cfg` (`MusicDevice = 1`) unless `--music`. Exit status: the game's own, 124 when stopped by the timeout, 125 for a script problem.

**Nothing in the game exits by itself** (`code-facts.md` §9: demos loop, there is no "run N tics and quit"), so every headless run ends with the timeout (124). SIGTERM reaches the game as the Escape key, so the script's watchdog has to SIGKILL it 5 s later and the config is not written. Brief 01 added test hooks: `-testquit<N>` ends a run by itself with status 0 (section 8).

What a run shows (the log is `duke3d.log` in the work directory):

```
Scanning for GRP files...   Checksumming duke3dshare.grp   GRP file: duke3dshare.grp
Compiling: game.con (99639 bytes)  Including: DEFS.CON  Including: USER.CON
Looks like Standard CON files.     Code Size: 48520 bytes (1425 labels).
Duke Nukem 3D (Unregistered Shareware)
Setting video mode 640x480 ...     FX driver is SDL ...
```

To see the picture, run the same binary under a virtual X server and take a screenshot (no game data in the repository, so keep the picture out of it):

```sh
mkdir -p /tmp/duke-run && cd /tmp/duke-run && touch user_profiles_disabled && ln -sf "$OLDPWD/testdata/duke3dshare.grp" .
printf '[Sound Setup]\nMusicDevice = 1\n' > duke3d.cfg
SDL_AUDIODRIVER=dummy HOME=$PWD xvfb-run -a -s "-screen 0 800x600x24" bash -c \
  "$OLDPWD/duke3d -nosetup -v1 -l1 & sleep 12; import -window root shot.png; kill -9 %1"
```

(`import` is ImageMagick's.) On a normal desktop run, the first time (no `duke3d.cfg`) the game shows its GTK startup window even with `-nosetup` (`code-facts.md` §3.2); `run-headless.sh` avoids that by unsetting `DISPLAY`. For a windowed run: `./duke3d` with the GRP in `~/.jfduke3d/` or next to the binary (the GRP scan covers the current directory, the binary's directory, `~/.jfduke3d` and `DATADIR`; but without `user_profiles_disabled` the game does `chdir ~/.jfduke3d` first, so "current directory" then means `~/.jfduke3d`, not where you started).

Game options used above: `-v1 -l1` (episode 1, level 1, skipping the logo and menus), `-r` (record `demo1.dmo`), `-dNAME` (play `NAME.dmo` as the first attract demo), `-q[N]` (fake N local players, no network), `-net …` (network games; `--` ends the network arguments). `code-facts.md` §3 and §9.

## 6. Emscripten (browser builds, from brief 02 on)

### 6.1 Toolchain

```sh
scripts/setup-emsdk.sh                  # emsdk + Emscripten 6.0.13 into ~/.cache/jfduke3d-browser/emsdk
scripts/setup-emsdk.sh --with-ports     # the same, plus the SDL2, Ogg and Vorbis ports
source ~/.cache/jfduke3d-browser/emsdk/emsdk_env.sh
emcc --version                          # 6.0.13
```

`EMSDK_DIR=/some/dir` changes the install location (the same variable as jfSW's script). The default is outside the worktree so that several worktrees share one install. **jfSW's install is the same emsdk revision**, so on a machine that has both projects: `EMSDK_DIR=~/.cache/jfsw-browser/emsdk scripts/setup-emsdk.sh --with-ports` reuses it instead of downloading a second copy (312 MB). `EM_CACHE=DIR` seeds and uses a private Emscripten cache instead of the emsdk's own.

`--with-ports` is for networks that block GitHub archive URLs (the cloud container answers 403). Emscripten downloads its ports from GitHub on first use; with `--with-ports` they are taken from the orphan branch `emscripten-ports` of this repository (archives of SDL2 2.32.10, libogg 1.3.5, libvorbis 1.3.7; the same branch as jfsw-browser's), checked against the SHA-512 in the pinned emsdk's `tools/ports/*.py`, and unpacked into Emscripten's cache the way Emscripten would, so `-sUSE_SDL=2` and `-sUSE_OGG=1 -sUSE_VORBIS=1` download nothing. It fetches that branch with git, so run it from a clone with the `origin` remote. It does not take Emscripten's cache lock, so don't run it while `emcc` is running. If the emsdk pin in the script changes, refresh the branch.

Check it:

```sh
cat > /tmp/t.c <<'C'
#include <SDL.h>
int main(void){ SDL_Init(SDL_INIT_VIDEO); SDL_Quit(); return 0; }
C
emcc /tmp/t.c -sUSE_SDL=2 -o /tmp/t.js && echo ok
```

### 6.2 Build the game for the browser

```sh
scripts/build-wasm.sh                   # incremental; the first build also builds Emscripten's system libraries
scripts/build-wasm.sh clean             # remove the wasm objects only
scripts/build-wasm.sh veryclean         # and the libraries and build-wasm/ (**and the native `duke3d`**: it is Makefile's veryclean; build native after)
EMSDK_DIR=~/.cache/jfsw-browser/emsdk scripts/build-wasm.sh   # reuse jfSW's emsdk install (same revision, same ports)
```

That is `emmake make -j4 USE_POLYMOST=0 USE_OPENGL=0` after sourcing the emsdk (the software renderer only, D6). `Makefile` includes `Makefile.emscripten` when the compiler is `emcc` and adds `-DDATADIR=\"/data\"` and `-O2` for the game; `jfbuild/Makefile.shared` and `jfaudiolib/Makefile.shared` recognise `wasm32-unknown-emscripten` as `PLATFORM=EMSCRIPTEN`. There is no startup window, no GTK and no map editor (`build`).

Objects are named `*.wasm.o` and libraries `lib*.wasm.a`, so a native build and a browser build live in the same tree without touching each other (`make clean` in one does not remove the other's objects, except `src/version-auto.c`, which both regenerate). The output is in `build-wasm/` (git-ignored): `index.html`, `jfduke3d.js`, `jfduke3d.css`, `config.js` (copied from `web/`), `duke3d.js` and `duke3d.wasm`.

**Networking.** Under Emscripten the engine library holds `mmulti.c` (its plain UDP code compiled out under `__EMSCRIPTEN__`), `mmulti_vnet.c` and `ext/vnet/src/*.c`, and the link adds `-lwebsocket.js` (vnet's WebSocket transport). Brief 02 was meant to link `mmulti_null.c` instead; the engine fork (`jfbuild` at `5950d14`) no longer has that switch (jfSW's brief 04 removed it) and the fork is not to change, so the browser links the real `mmulti.c`. Without `-net` arguments it behaves as the single-player stub does (`numplayers = 1`), and the page passes none; brief 04 gives the page the relay.

Debug build (function names in traces, run-time assertions) into another directory: `scripts/build-wasm.sh WASM_DEBUG=1 WASMDIR=build-wasm-debug`.

Link options: `-sASYNCIFY` (the game's loops block; `jfbuild/src/sdlayer2.c` hands control back to the browser once per frame, and in event-pumping loops that do not draw), `-sALLOW_MEMORY_GROWTH`, `-sEXIT_RUNTIME` (so `exit()` from anywhere reaches the page's `onExit`), `-sINVOKE_RUN=0` (the page starts `main` from the button), `-lidbfs.js`, `-lwebsocket.js`.

### 6.3 Serve and play

```sh
scripts/fetch-test-data.sh                     # testdata/duke3dshare.grp
cd build-wasm && ln -sf ../testdata/duke3dshare.grp .      # the page fetches ./duke3dshare.grp
python3 -m http.server 8000 --bind 127.0.0.1
# open http://127.0.0.1:8000/ in Chromium or Firefox, click "Click to start"
```

This brief's page loads the GRP with a plain `fetch` (brief 03 replaces that with the download, checks and cache): the default is `duke3dshare.grp` next to the page, `?data=<url>` another file (it must send CORS headers if it is on another origin). The page writes it to `/data/duke3d.grp` for the game (the game recognises GRPs by CRC32, not by name). The game keeps `duke3d.cfg`, saved games and the log in IndexedDB (the folder `/persist`); `/data` is in memory only. Page options and test hooks (`?test=1`, which also needs `testMode: true` in `config.js`) are described at the top of `web/jfduke3d.js`.

### 6.4 Browser tests

```sh
scripts/build-wasm.sh && make -j4           # (the native binary is not needed by these tests; brief 01's and the later determinism test need it)
make test-web                               # the five below, one after the other (the last fails in the cloud container)
node tests/web/smoke.js                     # intro, menu, a level, Escape, pointer, quit; no errors
node tests/web/persist.js                   # settings and saves survive a reload (also one without quitting, and one 250 ms after a save)
node tests/web/focus.js                     # brief 02c: a refused pointer lock or a lost focus does not end the game; a trap still does (about 1 minute)
node tests/web/loops.js                     # every loop of code-facts section 4 that the shareware data can reach: the page stays responsive and the loop ends
node tests/web/frametime.js                 # frame intervals over 40 s of play; its "no stall over 100 ms" check FAILS in the cloud container (software-rendered Chromium), see its header
```

They use the preinstalled Chromium through Playwright (`require('playwright')`; never run `playwright install`), serve `build-wasm/` and `testdata/duke3dshare.grp` on 127.0.0.1 ports 49101 and up (persist.js 49103, focus.js 49104, loops.js 49105, frametime.js 49106), and clean up after themselves. `focus.js` uses the full Chromium build in headless mode (`channel: 'chromium'`, the same preinstalled browser) rather than Playwright's default headless shell, which reports no mouse movement under pointer lock and crashes on a wasm trap. `JFDUKE3D_WEB_PORT_OFFSET=<n>` moves every port the browser tests use up by n, so that two checkouts can run them on one machine at once. Several of the checks have a sabotage switch that must make them fail: see the top of each test file.

#### Firefox (brief 02c's port; optional, not part of the default runs)

```sh
scripts/setup-firefox.sh                    # a pinned stock Firefox (160.0, SHA-256 checked) and puppeteer-core (25.17.0), in ~/.cache/jfduke3d-browser
FIREFOX_CACHE=~/.cache/jfsw-browser node tests/web/firefox.js    # reuse jfSW's copies (the same versions)
FIREFOX=/usr/bin/firefox node tests/web/firefox.js     # another Firefox (Arch: sudo pacman -S firefox); puppeteer-core still from the script
```

As in jfSW: Playwright's Firefox needs Playwright's own patched build, so `firefox.js` drives a stock Firefox headless over WebDriver BiDi with `puppeteer-core`, installed by `setup-firefox.sh` with `npm ci` from `tests/web/firefox-deps/package-lock.json` (`FIREFOX_CACHE=DIR` moves both; `--no-firefox` installs only `puppeteer-core`; `PUPPETEER_CORE=DIR` points the test at another copy). Headless Firefox never gives the page the focus, so it refuses every pointer-lock request as a desktop Firefox does after Alt+Tab. The test checks a single player game (refusals at start-up and after a click: logged, game running, no overlay) and a wasm trap (still fatal, with `?persist=0` and with persistence on). Port 49400. Without a Firefox or `puppeteer-core` it prints `firefox: NOT RUN` and exits with status 3, which is not a pass; with other versions in the cache, `firefox: VERSION MISMATCH` and status 3. `FIREFOX_SABOTAGE=unhandled` leaves the lock's promise unhandled, as before the fix: it must fail. jfSW's network parts of this test (a game through a relay, WebTransport) come with the Duke briefs that bring networking.

## 7. Layout of what brief 00 added

| Path | What |
|---|---|
| `scripts/setup.sh` | native dependencies (apt, pacman) |
| `scripts/setup-emsdk.sh` | pinned Emscripten and the ports |
| `scripts/fetch-test-data.sh` | verified `testdata/duke3dshare.grp` |
| `scripts/run-headless.sh` | headless, bounded game runs |
| `tests/fetch-test-data.sh`, `tests/run-headless.sh` | tests for the fetch and run scripts |
| `Makefile` (`test`, `test-scripts`) | runs those two tests |
| `ext/vnet` | vnet `v0.5.0` (submodule; built into `jfbuild/libengine.a`; the game uses it through `-relay` since brief 01) |
| `doco/browser/code-facts.md` | what the code does, with file:line |

Brief 02 added:

| Path | What |
|---|---|
| `Makefile.emscripten`, `scripts/build-wasm.sh` | the browser build into `build-wasm/` (section 6.2) |
| `web/` | the page: `index.html`, `jfduke3d.js`, `jfduke3d.css`, `config.js` |
| `tests/web/` | `lib.js`, `server.js` (shared), `smoke.js`, `persist.js`, `focus.js`, `loops.js`, `frametime.js`, `firefox.js` + `firefox-deps/` |
| `scripts/setup-firefox.sh` | a pinned stock Firefox and `puppeteer-core` for `firefox.js` |
| `Makefile` (`test-web`) | runs the browser tests |
| `src/menues.c` | the one game change: `duke3d.cfg` is written when the menu is left (`__EMSCRIPTEN__` only) |

## 8. Network games and their tests (brief 01)

Native players can play through a vnet relay as well as over plain UDP. The relay is a small Go program in the vnet submodule (`ext/vnet/relay`, Go 1.24 or newer); run it on any machine that players can reach by UDP:

```sh
(cd ext/vnet/relay && go build -o /tmp/vnet-relay ./cmd/vnet-relay)
/tmp/vnet-relay -udp :7777 -http "" -v           # UDP only: no WebSocket (a native-only relay); -max-members 8 is the default room size
```

```sh
./duke3d -allowsharewarenet -net -relay relay.example.org:7777 -host-room 3 -- -v1 -l1 -c2
# prints "mmulti: room code ABC234 ..." (stdout, duke3d.log, the on-screen console), then waits for two more players
./duke3d -allowsharewarenet -net -relay relay.example.org:7777 -room ABC234 -- -v1 -l1 -c2
```

`-host-room N` takes 2 up to 4 players on the shareware GRP (8 registered: the engine's room limit; plain UDP takes 16) and the relay's room size; more is clamped with a message. `-v1 -l1 -c2` starts episode 1 level 1 as co-op without menus once everyone is in; without them the host picks the game in the menus (`-c1` Dukematch, `-c2` co-op, `-c3` Dukematch without spawn). Game options go after `--` (what follows `-net` up to `--` is mmulti's). A failed start (bad code, no such room, room full, relay down) prints why and exits with status 1; so does a relay session lost during the game. Plain UDP as before: `./duke3d -net -nm:3 -- ...` for the master, `./duke3d -net -nm HOST[:PORT] -- ...` for the others. Impairment for testing: `VNET_IMPAIR="loss=5,dup=2,reorder=3,lat=20,jit=10,seed=N"` in the environment (own seed per process). Details: `code-facts.md` §15 and `jfbuild/include/mmulti_vnet.h`.

**The shareware network gate (D14).** With the shareware GRP, network games are refused by default (`Network game refused: ...`, exit 1), whether UDP or relay, unless the player allows them: `-allowsharewarenet` **before** `-net`, or in `duke3d.cfg`

```
[Comm Setup]
AllowSharewareNetGames = 1
```

Registered data always allows them. The shareware licence ([3][D]) does not give permission for online multiplayer services, so shareware netplay is meant for a LAN. The examples above and all the tests pass the switch.

**Test-only arguments** (after `--`; `src/testhooks.h`): `-testquit<N>` quit with status 0 after the N-th tic of the level (also in single player and demo playback), `-testsync` a sync byte of the whole state every tic (every player must use it), `-testnudge<T>` move this player 8 units at tic T (a desync on purpose), `-testdump<name>` write a 32 byte record per tic to `<name>` (read it with `tests/tools/testdump.py`), `-teststate[<T>]` also `<name>.state`, the state as text. A run with `-testquit` ends by itself; `scripts/run-headless.sh` runs one and returns the game's status.

Tests (all local, on 127.0.0.1, ports from `JFDUKE3D_TEST_PORT_BASE`, default 47400; they build the relay with Go into `~/.cache/jfduke3d-browser` the first time; each stops every process it started; keep `JFDUKE3D_TEST_KEEP=1` to keep a test's directory, `JFDUKE3D_TEST_VERBOSE=1` for the logs of a failing game):

```sh
make test                      # everything below, about 20 minutes
make test-mmulti               # mmulti over vnet with impairment, 10 runs (no game data needed), about 2 minutes
make test-net GAME_RUNS=3      # the rest; needs testdata/duke3dshare.grp
tests/net/test-mmulti-vnet.sh --runs 10 [--stub-resend]       # mmulti over vnet with loss, duplication, reordering
tests/net/test-three-games.sh [--udp] [--players N] [--tics N] [--impair SPEC] [--nudge N:T] [--no-testsync]   # N game processes, co-op, quit after N tics, every -testdump the same
tests/net/test-desync.sh [--game FILE]                        # a -testnudge is logged and shows in -testdump, with and without -testsync
tests/net/test-player-announce.sh [--game FILE] [--only relay-3|relay-4|udp-3]   # D1: every machine holds every player's announced settings (a different configuration for each player), dumps equal
tests/net/test-single.sh [--game FILE] [--tics N]             # -testquit and -testdump in single player and demo playback
tests/net/test-udp-unchanged.sh --base-game "$(tests/net/build-baseline.sh)" [--mutate-wire]   # plain -net against the pre-brief build
tests/net/test-errors.sh [--only REGEX] [--game FILE]         # bad code, full room, relay down, host leaves, caps
tests/net/test-relay-lost.sh [--game FILE]                    # a relay session lost during a game
tests/net/test-shareware-gate.sh [--game FILE]                # D14: refused by default, allowed by the option, registered data allowed
```

`tests/net/build-baseline.sh` builds the game as it was before brief 01 (`7e0cd72`). **`make test` therefore runs `git worktree add` on your repository** (a detached worktree in `~/.cache/jfduke3d-browser/baseline-<commit>`; `git worktree list` shows it, `git worktree remove --force` deletes it: the submodules need `--force`) and needs network access to the submodule forks the first time (it checks out jfbuild, jfaudiolib, jfmact and vnet there and builds them). After editing anything in `jfbuild/`, run `make test` or `make -C jfbuild USE_POLYMOST=1 USE_OPENGL=1 USE_ASM=0 libengine.a`: the top-level `make` does not rebuild an existing `jfbuild/libengine.a`. (The `make test` targets do it: `engine-current`.)

Running the suites of both games on one machine: one at a time (`flock /tmp/jfd-heavy-tests.lock make test-net`), they are timing sensitive.
