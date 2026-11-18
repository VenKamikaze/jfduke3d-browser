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

**Nothing in the game exits by itself** (`code-facts.md` §9: demos loop, there is no "run N tics and quit"), so every headless run ends with the timeout (124). SIGTERM reaches the game as the Escape key, so the script's watchdog has to SIGKILL it 5 s later and the config is not written. Brief 01 adds test hooks (`-testquit` and others).

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

The wasm build of the game (`scripts/build-wasm.sh`, `build-wasm/`, the page in `web/`) is **brief 02**: placeholder, nothing to run yet. `scripts/build-id.sh` (brief 05b) and `scripts/setup-firefox.sh` likewise.

## 7. Layout of what brief 00 added

| Path | What |
|---|---|
| `scripts/setup.sh` | native dependencies (apt, pacman) |
| `scripts/setup-emsdk.sh` | pinned Emscripten and the ports |
| `scripts/fetch-test-data.sh` | verified `testdata/duke3dshare.grp` |
| `scripts/run-headless.sh` | headless, bounded game runs |
| `tests/fetch-test-data.sh`, `tests/run-headless.sh` | tests for the fetch and run scripts |
| `Makefile` (`test`, `test-scripts`) | runs those two tests |
| `ext/vnet` | vnet `v0.5.0` (submodule; built into `jfbuild/libengine.a` already, not used by the game yet) |
| `doco/browser/code-facts.md` | what the code does, with file:line |
