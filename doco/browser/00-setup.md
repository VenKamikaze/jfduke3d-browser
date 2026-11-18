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
- The game is built as C and linked as C++ (`code-facts.md` §0): the link line says `g++`.
- Network: report any host that is blocked. `web.archive.org` resets connections from the cloud container; GitHub archive URLs answer 403 (hence `emscripten-ports`).
- Use placeholder host names (`game.example.org`) everywhere. Never commit game data.

## Outcome

Status: **review** (branch `browser/00-setup`; the coordinator marks it done after review and merge). No game, engine or fork code changed; no fork repository was pushed.

(Filled in below by the implementer.)
