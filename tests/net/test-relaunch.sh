#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Brief 05: the console's host re-launches the game with its own arguments, in the directory it was started in. The game
# changes into ~/.jfduke3d early on (app_main) unless a file user_profiles_disabled is in the current directory, so a
# re-launched game that did not go back would find relative arguments (-j ./data, -g file.grp, -dNAME) naming nothing. Here the
# game is started from a directory with the GRP in ./data (-j ./data), with HOME elsewhere (so it does change directory), and
# types "host 2" into its console at tic 60 (-testosd60,host 2); the re-launched game must find the GRP again and make a room.
#
#   tests/net/test-relaunch.sh [--game FILE]
#
# Passes when the game logs "Re-launching: ... -net -relay ... -host-room 2 --", the new process says it was re-launched,
# loads the GRP (relative -j path) and prints a room code. About 20 s.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

game="$root/duke3d"
while [ $# -gt 0 ]; do
    case "$1" in
        --game|--sw) game="$2"; shift 2 ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
    esac
done
t_need_data

rport=$((port_base + 140))
t_start_relay "$rport"
start="$t_tmp/start"; home="$t_tmp/home"
mkdir -p "$start/data" "$home/.jfduke3d"
ln -s "$root/testdata/duke3dshare.grp" "$start/data/duke3dshare.grp"
printf '[Sound Setup]\nMusicDevice = 1\n[Comm Setup]\nRelay = "127.0.0.1:%s"\n' "$rport" > "$home/.jfduke3d/duke3d.cfg"

t_note "a game started in $start (HOME elsewhere, so it changes directory) re-launches itself on 'host 2' and finds ./data again"
(
    cd "$start" || exit 125
    unset DISPLAY WAYLAND_DISPLAY
    export HOME="$home" SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy
    exec "$game" -nosetup -j ./data -allowsharewarenet -v1 -l1 -c2 -testquit600 "-testosd60,host 2"
) > "$t_tmp/g.out" 2>&1 &
gp=$!
t_pids+=("$gp")
t_wait_for "$t_tmp/g.out" 'mmulti: room code [A-Z0-9]{6}' 40
log="$home/.jfduke3d/duke3d.log"
t_check "the game typed host 2 and re-launched itself" grep -Eq "^Re-launching: \S+ -allowsharewarenet -net -relay 127\.0\.0\.1:$rport -host-room 2 -- " "$t_tmp/g.out"
t_check "the new process says it was re-launched" grep -q "Re-launched by host/join from a running game:" "$log"
t_check "the new process found the GRP through the relative -j ./data" grep -q "GRP file: .*duke3dshare.grp" "$log"
t_check "and made a room through the relay" grep -Eq "mmulti: room code [A-Z0-9]{6}" "$t_tmp/g.out"
t_check "the relay setting is kept in duke3d.cfg" grep -q "^Relay = \"127.0.0.1:$rport\"" "$home/.jfduke3d/duke3d.cfg"
kill -KILL "$gp" 2>/dev/null
t_result
