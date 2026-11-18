#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Run the game with no display, no sound and a throw-away home directory.
#
#   scripts/run-headless.sh [options] [--] [game arguments...]
#
#   --grp FILE      the GRP to use (default testdata/duke3dshare.grp; see
#                   scripts/fetch-test-data.sh)
#   --timeout SEC   stop the game after SEC seconds (default 30). jfDuke3D never
#                   ends by itself (a demo that ends starts the next one, or
#                   the menu), so a run that ends this way is not a failure of
#                   the game: it exits with 124. SIGTERM reaches the game as
#                   SDL's quit event, which the game takes for the Escape key
#                   (it opens the menu instead of quitting), so the game is
#                   killed with SIGKILL 5 s later and writes no config.
#                   A game that dies of its own SIGKILL keeps its 137.
#   --workdir DIR   run in DIR (created if needed, kept afterwards) instead of
#                   a temporary directory, e.g. to record a demo in one run
#                   and play it back in the next
#   --game FILE     the game binary (default ./duke3d); --sw is the same option
#                   (jfsw-browser's name for it)
#   --music         leave music on (by default it is turned off, see below)
#   --display       keep DISPLAY (for an X server such as xvfb-run's), so that
#                   the GTK startup window can open; the game still draws
#                   nothing (SDL's dummy video driver). Pass -setup to show it.
#
# What it sets up, all of it needed by the game as it stands:
#   * SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy, DISPLAY unset;
#   * HOME is the work directory, so nothing is written to the real home;
#   * a user_profiles_disabled file in the work directory. This is the game's
#     own switch for a "portable" install: the current directory is added to
#     the search path and duke3d.cfg, duke3d.log, grpfiles.cache and demos are written
#     there. (Without it the game chdirs into ~/.jfduke3d before it scans
#     for GRPs, and writes there.)
#   * a symlink to the GRP in the work directory, which the game's GRP scan
#     (current directory and search path, files recognised by CRC32) finds;
#   * -nosetup, which skips the startup window;
#   * no music: MusicDevice = 1 ("no music") in the work directory's duke3d.cfg
#     (created if missing, changed if present). SDL_AUDIODRIVER=dummy does not
#     reach the music drivers: on a desktop with an ALSA sequencer the game
#     would otherwise play MIDI through it (the jfaudiolib fork's F2 fix for
#     the driver's crash is in the pinned commit, but a test has no use for
#     music). Use --music to keep the work directory's own music setting.
#
# Exit status: the game's own, except 124 when the timeout stopped it
# (and 125 for a problem in this script, 2 for bad options).
#
# Runs the game offers (it has no "run N frames and quit" option, and nothing
# in it exits by itself, so every run needs --timeout):
#   -v1 -l1           starts episode 1 level 1 at once (no logo, no menu)
#   -v1 -l1 -r        the same, recording demo1.dmo (always that name)
#   -dNAME            plays NAME.dmo as the first demo, after the logo
#   -net ...          network games (brief 01)
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
grp="$root/testdata/duke3dshare.grp"
game="$root/duke3d"
secs=30
workdir=""
music=0
keepdisplay=0

while [ $# -gt 0 ]; do
    case "$1" in
        --grp) [ $# -ge 2 ] || { echo "--grp needs a file" >&2; exit 2; }; grp="$2"; shift 2 ;;
        --timeout) [ $# -ge 2 ] || { echo "--timeout needs seconds" >&2; exit 2; }; secs="$2"; shift 2 ;;
        --workdir) [ $# -ge 2 ] || { echo "--workdir needs a directory" >&2; exit 2; }; workdir="$2"; shift 2 ;;
        --game|--sw) [ $# -ge 2 ] || { echo "$1 needs a file" >&2; exit 2; }; game="$2"; shift 2 ;;
        --music) music=1; shift ;;
        --display) keepdisplay=1; shift ;;
        -h|--help) sed -n '2,/^set -uo/p' "${BASH_SOURCE[0]}" | sed '$d;s/^# \{0,1\}//'; exit 0 ;;
        --) shift; break ;;
        *) break ;;
    esac
done

[ -x "$game" ] || { echo "run-headless: $game not found: run make first" >&2; exit 125; }
[ -f "$grp" ] || { echo "run-headless: $grp not found: run scripts/fetch-test-data.sh" >&2; exit 125; }
case "$secs" in ''|*[!0-9]*) echo "run-headless: --timeout must be whole seconds" >&2; exit 2 ;; esac

created=""
if [ -z "$workdir" ]; then
    # Only a directory this script made itself is ever removed.
    created="$(mktemp -d)" || { echo "run-headless: cannot make a temporary directory" >&2; exit 125; }
    if [ -z "$created" ] || [ ! -d "$created" ]; then
        echo "run-headless: mktemp gave no directory" >&2
        exit 125
    fi
    trap 'rm -rf -- "$created"' EXIT
    workdir="$created"
else
    mkdir -p "$workdir" || exit 125
fi
workdir="$(cd "$workdir" && pwd)" || exit 125
game="$(cd "$(dirname "$game")" && pwd)/$(basename "$game")"
grp="$(cd "$(dirname "$grp")" && pwd)/$(basename "$grp")"

: > "$workdir/user_profiles_disabled"
if [ "$music" = 0 ]; then
    cfg="$workdir/duke3d.cfg"
    if [ ! -e "$cfg" ]; then
        printf '[Sound Setup]\nMusicDevice = 1\n' > "$cfg" || exit 125
    elif grep -q '^MusicDevice[[:space:]]*=' "$cfg"; then
        sed -i 's/^MusicDevice[[:space:]]*=.*/MusicDevice = 1/' "$cfg" || exit 125
    else
        printf '\n[Sound Setup]\nMusicDevice = 1\n' >> "$cfg" || exit 125
    fi
fi
ln -sf "$grp" "$workdir/$(basename "$grp")"

cd "$workdir" || exit 125
unset WAYLAND_DISPLAY
[ "$keepdisplay" = 1 ] || unset DISPLAY
export HOME="$workdir" SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy

# Our own watchdog rather than timeout(1), so that a game that dies of SIGKILL
# (for instance the OOM killer, status 137) is not mistaken for a timeout.
flag="$workdir/.run-headless-timeout"
rm -f "$flag"
gpid=""
wpid=""
# freeze the watchdog, kill its sleep, then the watchdog (it must not reach its kill)
stop_watchdog() {
    [ -n "$wpid" ] || return 0
    kill -STOP "$wpid" 2>/dev/null
    pkill -P "$wpid" 2>/dev/null
    kill -KILL "$wpid" 2>/dev/null
    wait "$wpid" 2>/dev/null
    wpid=""
}
# If this script is interrupted or terminated, take the game down with it.
# Background jobs of a non-interactive shell ignore SIGINT, so without this a
# Ctrl-C (or a test harness stopping us) leaves the game running with its work
# directory deleted under it.
on_signal() {
    trap - INT TERM HUP
    stop_watchdog
    if [ -n "$gpid" ]; then
        kill -TERM "$gpid" 2>/dev/null
        for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$gpid" 2>/dev/null || break; sleep 0.5; done
        kill -KILL "$gpid" 2>/dev/null
        wait "$gpid" 2>/dev/null
    fi
    exit "$1"
}
trap 'on_signal 130' INT
trap 'on_signal 143' TERM
trap 'on_signal 129' HUP
"$game" -nosetup "$@" &
gpid=$!
( sleep "$secs"; : > "$flag"; kill -TERM "$gpid" 2>/dev/null; sleep 5; kill -KILL "$gpid" 2>/dev/null ) &
wpid=$!
wait "$gpid" 2>/dev/null     # 2>/dev/null: no "Killed" report from bash
rc=$?
trap - INT TERM HUP
stop_watchdog
if [ -e "$flag" ]; then
    rm -f "$flag"
    echo "run-headless: stopped after ${secs}s" >&2
    exit 124
fi
exit "$rc"
