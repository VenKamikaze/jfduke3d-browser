# 00: Repo set-up, baseline and code facts

## Goal

Make the repository ready for briefs 01 to 06: submodules that resolve from a fresh clone, vnet at `ext/vnet`, set-up scripts for the native and Emscripten toolchains, verified test data, a green native build, a way to run the game headless, and a verified `code-facts.md` that later briefs can trust. This is the jfDuke3D twin of jfsw-browser's brief 00: same files, same names (`jfsw` -> `jfduke3d`), same structure, so the two games stay easy to maintain together.

## Read first

- [`README.md`](README.md): decisions D1 to D12, the answers to the open questions, and **"Working across repos"** (the forks are shared with jfSW).
- [`PROMPT.md`](PROMPT.md) §0 (where things stand) and §3 (settled decisions).
- jfsw-browser's [`doco/browser/porting-jfduke3d.md`](https://github.com/VenKamikaze/jfsw-browser/blob/claude/doco/browser/porting-jfduke3d.md): what jfSW's briefs 00 to 06b changed and found, and how much of it applies here. Every claim in it about jfDuke3D was unverified; your [`code-facts.md`](code-facts.md) replaces it.
- jfsw-browser's `doco/browser/00-setup.md` (the brief this one copies), `scripts/`, `tests/`, `.gitmodules`.
- vnet: `doco/integration.md` in `VenKamikaze/vnet` at tag `v0.5.0`, in particular "Vendoring without CMake".

## In scope

### 1. Submodules

- `.gitmodules`: absolute URLs `https://github.com/VenKamikaze/jfbuild.git`, `.../jfmact.git`, `.../jfaudiolib.git`, with `branch = claude` for jfbuild and jfaudiolib and `branch = master` for jfmact (the fork has no `claude`, see the README).
- Pins: jfbuild **`5950d14`** (the fork's `claude`: the vnet-backed mmulti, the relay lobby, "Start now", the Emscripten platform layer), jfaudiolib **`ff1b31d`** (the fork's `claude`: the F2 ALSA MIDI fix), jfmact **`731c0cc`**. Upstream jfduke3d pins the older commits (`40a98be`, `68be97f`, `731c0cc`); jfSW moved to the forks' `claude` branches in its own briefs, and Duke starts there.
- Add vnet as a submodule at `ext/vnet`, URL `https://github.com/VenKamikaze/vnet.git`, checked out at tag **`v0.5.0`** (`8572c74`). Nothing in the game uses it yet (brief 01 does); jfbuild's Makefile already compiles it into `libengine.a`.
- If the moved jfbuild needs a game-side change to build, make the minimum change and record it.

### 2. `scripts/setup.sh` (native dependencies)

Installs what the native build and the later briefs need (compiler and make, SDL2, libvorbis + libogg, pkg-config, curl, unzip, Python 3, optional GTK3; Go only checked). apt and pacman; idempotent and non-interactive; `--no-gtk`.

### 3. `scripts/setup-emsdk.sh` (Emscripten 6.0.13, D12)

- Pinned emsdk revision and Emscripten `6.0.13`, fetched with git, **`EMSDK_DIR` override**, default `${XDG_CACHE_HOME:-$HOME/.cache}/jfduke3d-browser/emsdk`. (Same pin as jfSW's script, so a machine with both can point both at one install.)
- `--with-ports`: seeds Emscripten's cache from the orphan branch **`emscripten-ports`** (SDL2, libogg, libvorbis archives, because GitHub archive URLs answer 403 in the cloud container). **That branch is jfsw-browser's, copied as it is** into this repository and pushed; it is the only branch besides the brief's own that this brief pushes.
- In the cloud container do **not** download a second emsdk: check the script's logic against jfSW's existing install under `~/.cache/jfsw-browser/emsdk`.

### 4. `scripts/fetch-test-data.sh` (shareware data)

- Downloads Duke Nukem 3D 1.3D shareware, `3dduke13.zip`, from `https://image.dosgamesarchive.com/games/3dduke13.zip`, falling back to `https://archive.org/download/3dduke13/3dduke13.zip`. The two are different releases of the zip (different layouts and MD5s); the script knows both.
- Checks the zip's MD5, takes `DUKE3D.GRP` out (the zip holds a nested archive: `DN3DSW13.SHR`, or `DUKE3DS._1` … `_5` that join into one zip; Python's `zipfile`, no exotic tools) and checks the GRP's CRC32 (`0x983AD923`) and size (11,035,779) against the "Shareware Version" entry in `src/grpscan.c`.
- Writes `testdata/duke3dshare.grp`. `testdata/` is git-ignored. Skips the download when a valid file is already there. Fails loudly, with a non-zero exit, on any mismatch, and never leaves an unverified file at the destination. `--dest DIR`, `--from-zip FILE`, `--md5 HEX` (tests only).
- Record the source URLs, the MD5s and the **shareware licence** text and location (for brief 06's `deploy.md`).

### 5. Native build and headless run

- `make veryclean && make -j4` is green on Ubuntu 24.04 with the defaults (`USE_POLYMOST=1 USE_OPENGL=1`) and with `USE_POLYMOST=0 USE_OPENGL=0` (the software renderer is what the browser uses, D6). It builds `duke3d` and `build`. Record warnings that look relevant, don't fix them.
- `scripts/run-headless.sh`: `SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy`, `-nosetup`, a throw-away `HOME` and work directory with a `user_profiles_disabled` file, the GRP linked in, music off, a timeout, the game's own exit status (124 for a timeout), extra game arguments passed through. Find out how to get a **bounded, scripted run**; do **not** add hooks to the game here (brief 01 does).
- **Prove** the game starts, loads the GRP and the CON scripts, and reaches the menu or a level, and record how you know.

### 6. Tests skeleton

`tests/fetch-test-data.sh` and `tests/run-headless.sh`, the tests of the two scripts, and a `make test` target that runs them. (jfSW's brief 00 had no `make test`; its brief 01 created one. Duke gets a minimal one now; 01 adds the network tests to it.)

### 7. Docs

`00-setup.md` (this file), `README.md`, `PROMPT.md`, `code-facts.md`, `building.md`, `bugs.md`, as in jfSW's brief 00, adapted:

- **`code-facts.md`**: verified, with file:line for every fact. The netcode (`getpackets`, `faketimerhandler`, `moveloop`, `domovethings` and its return values, prediction, the sync value and `checksync()`, `waitforeverybody`, `BYTEVERSION`, every packet type); how `networkmode` is chosen, where `-net` is parsed, the startup-window join fields; player caps and the `VOLUMEONE` branches; every blocking loop and what it pumps; every writer of `MODE_EOL` and the level-exit path; the GRP table, the CON loading order and override rules, `-g` and the search path; the CON VM's per-tic entry points and a first list of `myconnectindex`/`screenpeek`/`ud.` reads in simulation code; demos; renderer and audio flags; the console commands; the network menus; and **corrections to the hand-over write-up**.
- Update the status table in `README.md` and fill in this brief's **Outcome**.

## Out of scope

- Any change to game or engine code (`src/`, `jfbuild/`, `jfaudiolib/`, `jfmact/`) and any change to the forks or to vnet. If something won't build without one, stop and report it.
- Any networking code, the Emscripten build of the game, page files (briefs 01, 02).
- Fixing a game bug found while reading: record it in `code-facts.md` §12 or `bugs.md`.
- `scripts/build-wasm.sh`, `build-id.sh`, `setup-firefox.sh` (later briefs).
- CI.

## Acceptance criteria

1. `git clone --recurse-submodules -b browser/00-setup https://github.com/VenKamikaze/jfduke3d-browser` into an empty directory gives every submodule at its pin: jfbuild `5950d14`, jfaudiolib `ff1b31d`, jfmact `731c0cc`, `ext/vnet` `8572c74` (`v0.5.0`).
2. In that clone, `scripts/setup.sh` then `make -j4` builds `duke3d` and `build`, with both renderer settings.
3. `scripts/fetch-test-data.sh` produces a verified `testdata/duke3dshare.grp`, is a no-op on a second run, and fails (non-zero, no file left behind) on a corrupt or truncated zip and on a GRP with the wrong CRC or size.
4. `scripts/run-headless.sh` starts the game on the shareware GRP, gets past GRP detection and CON compilation and into a level, and stops within a bounded time. Say exactly how it ends and how you know it reached a level.
5. `scripts/setup-emsdk.sh --with-ports` is checked: the logic is exercised against an existing emsdk with a private cache, and the SDL2 and Ogg/Vorbis test programs link with no download attempted.
6. The `emscripten-ports` branch is pushed to this repository and holds only library archives.
7. `code-facts.md` covers the list in §7 above, with file:line refs, and a "Corrections to `porting-jfduke3d.md`" section.
8. No GRP, zip or other game data is in any commit on `browser/00-setup` (`git ls-files`, `git diff --stat claude..`).

## Tests

- `tests/fetch-test-data.sh` (bash): runs the fetch script against local copies of both zips (`--from-zip`) into temporary directories, and checks: both layouts; the second-run no-op; a truncated zip; a zip with one flipped byte; a GRP of the right size and wrong CRC, in both layouts (built); a wrong size; a zip that is not `3dduke13.zip`; an unknown MD5; a stale bad GRP; leftovers of a killed run; a missing `python3`; the script's constants against `src/grpscan.c`. Each failing case must exit non-zero and leave no file behind. Show the test fails if the CRC check is removed from the script.
- `tests/run-headless.sh` (fake game binary and fake GRP, no data or build needed).
- The headless run and the emsdk check are manual: put the commands and their output, trimmed, in the Outcome.

## Dependencies

The user's answers (README). Push access to `VenKamikaze/jfduke3d-browser` (granted for `browser/00-setup` and `emscripten-ports`).

## Notes

- **Git:** work on `browser/00-setup` (from `claude`, which is upstream `master` `55c5f95`). Push only that branch and `emscripten-ports`. Never merge, never touch `claude` or `master`, never open a PR, never force-push. The coordinator merges. This brief changes no fork.
- Builds use `-j4` (the cloud container has 4 cores).
- The game is built as C and linked as C++ (top of `code-facts.md`): the link line says `g++`.
- Network: report any host that is blocked. `web.archive.org` resets connections from the cloud container; GitHub archive URLs answer 403 (hence `emscripten-ports`).
- Use placeholder host names (`game.example.org`) everywhere. Never commit game data.

## Outcome

Status: **review** (branch `browser/00-setup`; the coordinator marks it done after review and merge). No game, engine or fork code changed; no fork repository was pushed. Commits on the branch, from `claude` (`55c5f95`): `dda549e` submodules and `.gitignore`; `49b6901` scripts, tests and the `make test` target; `4b4ea4f` the docs; and the commit that adds this Outcome. The `emscripten-ports` branch (`a8ec8bc`, jfSW's, unchanged) is pushed too.

**What landed**

- `.gitmodules`: absolute URLs for the three forks, `branch = claude` for jfbuild and jfaudiolib, `branch = master` for jfmact. Pins: jfbuild `5950d14`, jfaudiolib `ff1b31d`, jfmact `731c0cc`. `ext/vnet` added at `v0.5.0` (`8572c74`), with no `branch =` line (as jfSW's). jfbuild's Makefile already compiles all 13 vnet sources into `libengine.a` (with `-D_POSIX_C_SOURCE=200809L`, so there was nothing to check by a throwaway compile).
- `scripts/setup.sh`, `scripts/setup-emsdk.sh`, `scripts/fetch-test-data.sh`, `scripts/run-headless.sh`, `tests/fetch-test-data.sh`, `tests/run-headless.sh`, and a minimal `make test` (`test-scripts`: the two tests). `setup.sh` and `setup-emsdk.sh` are jfSW's current versions with `jfsw-browser` -> `jfduke3d-browser` (same emsdk revision `d7b4130`, Emscripten 6.0.13, same `EMSDK_DIR` and `EM_CACHE` variables). `fetch-test-data.sh` and `run-headless.sh` are rewritten for Duke (below). `.gitignore` lists `/testdata/`.
- Orphan branch `emscripten-ports`, fetched from the local jfsw-browser clone and pushed unchanged (SDL2 `release-2.32.10.zip`, `libogg-1.3.5.zip`, `libvorbis-1.3.7.zip`, `SHA512SUMS`, a README; library archives only).
- Docs: `README.md`, `PROMPT.md`, this brief, `code-facts.md` (299 lines; 14 sections; every `file:line` was checked mechanically against the source and the cited line read), `building.md`, `bugs.md`.

**Test data**

- Sources and checksums (both downloaded and verified here):

  | Source | Zip MD5 | Size | Layout |
  |---|---|---|---|
  | `https://image.dosgamesarchive.com/games/3dduke13.zip` | `29b2f40990069d9cb0dbaf0f811d1118` | 5,910,927 | `INSTALL.EXE`, `DUKE3DS.IFC`, `DUKE3DS._1` … `_5`, `FILE_ID.DIZ`; `_1` … `_5` joined are one zip (with 1,380 bytes of header in front) holding the game's 20 files |
  | `https://archive.org/download/3dduke13/3dduke13.zip` | `04e4ca70b8a2d59ed56c451c5c1d5d39` | 5,924,374 | `INSTALL.EXE`, `LICENSE.TXT`, `DN3DSW13.SHR` (a zip with 17 files), `FILE_ID.DIZ` |

  The brief expected a nested `.SHR`; only the second release has one, so the script reads both. Both hold the same `DUKE3D.GRP`: **CRC32 `0x983AD923`, 11,035,779 bytes**, equal to the "Shareware Version" entry of `src/grpscan.c:45`. The fallback to archive.org was run for real (first URL broken on purpose). The GRP also holds `GAME.CON`, `USER.CON` and `DEFS.CON` (the log shows them compiled), `DUKE.RTS` is not in it.
- `web.archive.org` was not tried (known to reset connections). No host was blocked.

**Licence** (for brief 06's `deploy.md`). The licence is `LICENSE.DOC` inside the game archive (inside `DUKE3DS._1` … `_5` joined; `LICENSE.TXT` in `DN3DSW13.SHR` and beside it in the archive.org zip; the game's start-up text says "Please read LICENSE.DOC"). It is the "Episode One of Duke Nukem 3D … Copyright 1996 3D Realms Entertainment" licence: `[V.4.24.96]` in the dosgamesarchive release and `[V.7.16.98]` in the archive.org one; the two differ only in the telephone number and in the list of files, and the sections quoted here are the same word for word. Section [3] "GRANT":

> [A] INDIVIDUALS are encouraged to share and give copies of the Game to friends, family, coworkers, and members of any not-for-profit organization, but only without charge.
> [B] ONLINE SERVICES (including BBSs, and WWW and FTP sites) that are free (except for any subscription fees or incidental Internet access charges), and BBSs with 250 or fewer nodes (regardless of any charges to users) may make the Game available for downloading.
> [C] These grants are subject to the conditions that no copyright information or trademark will be added or removed, and all of the Game's files as released by 3D Realms will be included without modification (except for "New Levels" …). The files at a minimum include: commit.exe, defs.con, demo1-3.dmo, dn3dhelp.exe, duke.rts, duke3d.exe, duke3d.grp, game.con, license.txt, modem.pck, readme.doc, setmain.exe, setup.exe, ultramid.ini, user.con …
> [D] *ALL* other distribution, including by lease, rental, **online service (other than a fewer than 250 node BBS) that charges for online access time, online service providing multiplayer use**, CD-ROM, catalog, and retail rack REQUIRES WRITTEN PERMISSION (which 3D Realms may withhold in its discretion) AND PRE-PAYMENT OF A LICENSE FEE OR OTHER MUTUALLY AGREED BENEFIT.

Points for brief 06 and the user: **(1)** [3][C] asks that all the game's files be distributed together and unmodified; the browser game serves only `DUKE3D.GRP`. **(2)** [3][D]'s "online service providing multiplayer use" can be read as covering a free web game with a multiplayer relay; the user should decide whether that matters (permission from 3D Realms, or only offering the single-player data path publicly). This is not legal advice; I only quote it. **(3)** [4] forbids new levels that work with the shareware episode.

**Tests** (run here)

- `tests/fetch-test-data.sh` against both real zips: **40 passed, 0 failed** (both layouts, the second-run no-op, a truncated zip, one flipped byte, right size and wrong CRC in each layout, a wrong size, a zip that is not `3dduke13.zip`, an unknown MD5, a stale bad GRP removed or replaced, leftovers of a killed run, a missing `python3`, the constants against `src/grpscan.c`). With the CRC check line removed from the script: **36 passed, 4 failed** (the wrong-CRC cases in both layouts exit 0 and leave the file); restored: 40 of 40. It also passes with no arguments (it downloads both zips).
- `tests/run-headless.sh` (fake game, no data needed): **24 passed, 0 failed**, including a game that ignores SIGTERM (as Duke does) and must end as 124 with no "Killed" line, and `--sw` as an alias of `--game`. With the `2>/dev/null` that hides bash's "Killed" report removed: 23 passed, 1 failed.
- `make test` runs both (about 15 s, with the downloads).

**Native build** (fresh `git clone --recurse-submodules -b browser/00-setup`, `make -j4`, about 20 s): green with the defaults (12 warnings) and, after `make veryclean`, with `USE_POLYMOST=0 USE_OPENGL=0` (7 warnings); also with `WITHOUT_GTK=1`. Both build `duke3d` and `build`. **The jfbuild at `5950d14` needed no change in the game.** Warnings are listed in `code-facts.md` §11 (three in the game, none relevant). **Packages:** nothing new was installed; `scripts/setup.sh` ran `apt-get install` over packages that were already there and only **upgraded** `libglx-mesa0`, `libgbm1`, `libgbm-dev`, `mesa-libgallium`, `libgl1-mesa-dev`, `libgl1-mesa-dri`, `libegl1-mesa-dev`, `libegl-mesa0` and `ca-certificates`. Go 1.24.7 was already installed.

**Headless run** (manual check). Commands and what they showed:

```
$ scripts/run-headless.sh --timeout 8 --workdir /tmp/wd -v1 -l1 -r
run-headless: stopped after 8s                       (exit 124; the game does not exit on SIGTERM, the watchdog kills it)
$ cat /tmp/wd/duke3d.log   (trimmed)
Scanning for GRP files...   Checksumming duke3dshare.grp   GRP file: duke3dshare.grp
Compiling: game.con (99639 bytes)   Including: DEFS.CON (28893 bytes)   Including: USER.CON (36960 bytes)
Looks like Standard CON files.   * WARNING!(L157 game.con) Expected a 'action' label ...   Code Size: 48520 bytes (1425 labels).
Duke Nukem 3D (Unregistered Shareware)   RTS file DUKE.RTS was not found
Setting video mode 640x480 ...   FX_Init: trying SDL   SDLDrv: audio driver: dummy   Cache time: 3ms   Press F1 for Help
$ ls /tmp/wd/demo1.dmo      -> exists (0 bytes: written through stdio, killed before the flush)
```

- **How I know it reached a level:** the log is silent after "Press F1 for Help", and the dummy video driver draws nothing, so I did two checks that are not part of the scripts: (1) `-r` makes `enterlevel` open `demo1.dmo` (`premap.c:1500-1501`), and the file exists after the run; (2) the same binary under `xvfb-run` with the real SDL video driver and a screenshot (`import -window root`) after 12 s of `-v1 -l1` shows **E1L1's rooftop with the status bar** (health 100, pistol 48 ammo), and, without `-v/-l`, pressing Space three times reaches the episode menu ("L.A. MELTDOWN, LUNAR APOCALYPSE, SHRAPNEL CITY"). The screenshots are game data and are not committed.
- **How runs end:** only by the timeout (124). There is no self-ending run: demos loop and the menu has no timeout (`code-facts.md` §9). SIGTERM is taken for the Escape key, so the script has to SIGKILL the game 5 s later; the config is then not written.
- Option names differ from jfSW: `-v1 -l1` (not `-level1`), `-r` records `demo1.dmo` (not `-dr`), `-dNAME` plays (not `-dp`); no `-demosync*`.

**Exploratory, not a test (for brief 01):** with the relay from jfSW's cache (`vnet-relay-8572c74`) on `127.0.0.1`, two unchanged `run-headless.sh` games, `-- -net -relay 127.0.0.1:P -host-room 2 -- -v1 -l1` and `-- -net -relay … -room CODE -- -v1 -l1`, connected: the host logged "room code 8PJSHG … Player 1 is here", the guest "joined room … as 10.0.0.2 … Player 0 is here", and both reached the "Press F1 for Help" point. So the engine side works through the game's `-net` pass-through as it is. I did not look at whether the two then play in step (the guest log shows "PRESS SPACE TO RESTART LEVEL" after 15 s, not understood). Processes and relay were stopped afterwards.

**setup-emsdk.sh** (the container may not download a second emsdk). Not run on a clean `EMSDK_DIR`. Instead, against jfSW's existing install and a private cache:

```
$ EMSDK_DIR=$HOME/.cache/jfsw-browser/emsdk EM_CACHE=/tmp/emcache scripts/setup-emsdk.sh --with-ports
...                                                    (emsdk install/activate of an installed 6.0.13: no download)
seeded port sdl2 from release-2.32.10.zip              (fetched from THIS repository's origin emscripten-ports, SHA-512 checked
seeded port ogg from libogg-1.3.5.zip                   against the pinned emsdk's tools/ports/*.py)
seeded port vorbis from libvorbis-1.3.7.zip
emsdk 6.0.13 is installed in /root/.cache/jfsw-browser/emsdk
$ emcc sdl.c -sUSE_SDL=2 -o sdl.js          -> links, no download     (EM_CACHE=/tmp/emcache)
$ emcc ov.c -sUSE_OGG=1 -sUSE_VORBIS=1 ...  -> links; node ov.js prints "Xiph.Org libVorbis 1.3.7"
```

It exercises the script's logic (the git fetch of the `emscripten-ports` branch from `origin`, the hash check, the unpacking and the markers). The default install directory `~/.cache/jfduke3d-browser/emsdk` was **not** exercised (the script is jfSW's with one path changed). The private cache was deleted afterwards. The jfSW install's `.emscripten` file was rewritten by `emsdk activate` with the same content.

**Fresh clone** (acceptance criterion 1 and 8): `git clone --recurse-submodules -b browser/00-setup https://github.com/VenKamikaze/jfduke3d-browser` took 8 s and gave `ext/vnet` `8572c74 (v0.5.0)`, jfaudiolib `ff1b31d`, jfbuild `5950d14`, jfmact `731c0cc`. In that clone: `make -j4`, `scripts/fetch-test-data.sh` (downloads and verifies) and `scripts/run-headless.sh --timeout 8 -v1 -l1 -r` (exit 124) all worked, and so did a `USE_POLYMOST=0 USE_OPENGL=0` rebuild. `git ls-files` lists no GRP, zip or `testdata`; `git diff --stat 55c5f95..` shows only scripts, tests, docs, `Makefile`, `.gitmodules`, `.gitignore` and the five submodule pointers.

**Not verified:** the pacman path of `scripts/setup.sh` (no Arch machine); `setup-emsdk.sh` on an empty `EMSDK_DIR` (not allowed here, see above); the Windows and macOS startup windows and builds (not built).

**Open questions for the coordinator**

1. **The licence's [3][D]** ("online service providing multiplayer use"): see "Licence" above.
2. **The engine's `Module.jfsw*` names** (`code-facts.md` §10): leave them and have the Duke page provide them, or rename in the shared fork for both games.
3. **Bug numbering:** `bugs.md` proposes jfSW's L-numbers for shared engine bugs and `D1…` for Duke's own. Change it if you prefer one sequence.
4. **Brief 01 may be smaller than expected:** the relay transport already works through the game's `-net` pass-through (exploratory run above), so 01 is mostly the test hooks (`-testquit`, a log line for the out-of-sync message, `-testdump`), the tests and the 4-player shareware cap.
5. `code-facts.md` §5: the level-exit code has jfSW's L20 shape (not tested, not fixed). A1's level-exit test decides.
