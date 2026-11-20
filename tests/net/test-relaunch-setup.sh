#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Brief 05 fix round: the native re-launch of host and join must not bring the startup window back. ForceSetup defaults to 1
# (config.c), so a default desktop install opens the window at every start unless -nosetup is given; the re-launched game
# (NetRestart(), src/netlobby.c) used to copy the old arguments without it, made its room (initmultiplayersparms() runs before the
# window) and then sat at a useless window, with the window's online choices ignored because -net was given.
#
# Here the game is started with ForceSetup = 1 in its duke3d.cfg and NO -nosetup, on a virtual X display (Xvfb), with the test-only
# JFDUKE3D_TEST_STARTWIN="go" that presses the window's Start (single player). Then it hosts or joins:
#   console-host   -testosd40,host 2 in a single player game
#   console-join   -testosd40,join CODE (a host started headless in the same relay)
#   menu-host      no -v/-l: the title menu, keys from xdotool: G (HOST ONLINE), Enter, 2, Enter
# Every case must show exactly ONE "TEST: startup window" line in the output of the whole run (the first start; the process is the
# same, it execs itself, so its output file goes on) and the room code / "joined room" of the re-launched game; without the
# -nosetup of the re-launch there are two lines and no second room code.
#
#   tests/net/test-relaunch-setup.sh [--game FILE]
#
# Needs Xvfb, xdotool and a GTK build; otherwise NOT RUN (exit 3). About 1 minute.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

game="$root/duke3d"
while [ $# -gt 0 ]; do
    case "$1" in
        --game) game="$2"; shift 2 ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
    esac
done
for tool in Xvfb xdotool; do
    command -v "$tool" >/dev/null || { echo "relaunch-setup: NOT RUN: $tool is not installed"; exit 3; }
done
grep -q startwin_netlobby "$game" 2>/dev/null || { echo "relaunch-setup: NOT RUN: $game has no GTK startup window"; exit 3; }
t_need_data

rport=$((port_base + 150))
t_start_relay "$rport"
Xvfb -displayfd 3 -screen 0 800x600x24 -nolisten tcp 3>"$t_tmp/display" >"$t_tmp/xvfb.log" 2>&1 &
t_pids+=("$!")
for i in $(seq 1 100); do [ -s "$t_tmp/display" ] && break; sleep 0.1; done
[ -s "$t_tmp/display" ] || { echo "Xvfb did not report a display:"; cat "$t_tmp/xvfb.log"; exit 125; }
display=":$(head -1 "$t_tmp/display")"

# a work directory the game takes for a portable install, with the setup window forced on and a relay setting
mkwd() {
    local wd="$t_tmp/$1"
    mkdir -p "$wd"
    : > "$wd/user_profiles_disabled"
    ln -sf "$root/testdata/duke3dshare.grp" "$wd/duke3dshare.grp"
    printf '[Setup]\nForceSetup = 1\n[Sound Setup]\nMusicDevice = 1\n[Comm Setup]\nRelay = "127.0.0.1:%s"\n' "$rport" > "$wd/duke3d.cfg"
}
# start NAME ARGS...: the game on the virtual display, with no -nosetup; its output (the re-launched process writes to the same file)
start() {
    local name="$1"; shift
    mkwd "$name"
    ( cd "$t_tmp/$name" && exec env DISPLAY="$display" HOME="$t_tmp/$name" SDL_AUDIODRIVER=dummy JFDUKE3D_TEST_STARTWIN=go "$game" -allowsharewarenet "$@" ) > "$t_tmp/$name.out" 2>&1 &
    game_pid=$!
    t_pids+=("$game_pid")
}
windows() { grep -c '^TEST: startup window' "$t_tmp/$1.out"; }

t_note "console-host: ForceSetup = 1, no -nosetup, host 2 from the console (load $(cut -d' ' -f1-3 /proc/loadavg))"
start ch -v1 -l1 -c2 "-testosd40,host 2"
t_wait_for "$t_tmp/ch.out" 'mmulti: room code [A-Z0-9]{6}' 60
sleep 4
t_check "console-host: the game re-launched itself (with -nosetup first)" grep -Eq '^Re-launching: \S+ -allowsharewarenet -nosetup -net -relay ' "$t_tmp/ch.out"
t_check "console-host: the re-launched game made its room" grep -Eq 'mmulti: room code [A-Z0-9]{6}' "$t_tmp/ch.out"
t_check "console-host: the startup window came up once, not again ($(windows ch))" test "$(windows ch)" = 1
t_check "console-host: the room waits in the lobby" grep -q 'Lobby: 1 of 2 players are in room' "$t_tmp/ch.out"
code="$(grep -o 'mmulti: room code [A-Z0-9]*' "$t_tmp/ch.out" | head -1 | awk '{print $4}')"
kill -KILL "$game_pid" 2>/dev/null

t_note "console-join: join $code from the console of a game with ForceSetup = 1 and no -nosetup"
# a headless host takes the place of the room's owner: made again here, the first host's game is gone
t_game jh "$t_tmp/jh" --timeout 90 -- -net -relay "127.0.0.1:$rport" -host-room 2 -- -v1 -l1 -c2
t_wait_for "$t_tmp/jh.out" 'room code [A-Z0-9]{6}' 30
jcode="$(grep -o 'room code [A-Z0-9]*' "$t_tmp/jh.out" | head -1 | awk '{print $3}')"
start cj -v1 -l1 -c2 "-testosd40,join $jcode"
t_wait_for "$t_tmp/cj.out" "mmulti: joined room $jcode" 60
sleep 3
t_check "console-join: the game re-launched itself with -nosetup" grep -Eq "^Re-launching: \S+ -allowsharewarenet -nosetup -net -relay \S+ -room $jcode " "$t_tmp/cj.out"
t_check "console-join: the re-launched game joined the room" grep -q "mmulti: joined room $jcode" "$t_tmp/cj.out"
t_check "console-join: the startup window came up once, not again ($(windows cj))" test "$(windows cj)" = 1
kill -KILL "$game_pid" 2>/dev/null

t_note "menu-host: the title menu, HOST ONLINE (G, Enter), 2 PLAYERS (2, Enter)"
start mh -testmenu
export DISPLAY="$display"
xdotool mousemove 400 300 2>/dev/null
# (the game's log is flushed as it goes; its stdout, a file, is not)
menu_is() { t_wait_for "$t_tmp/mh/duke3d.log" "TEST: menu $1\$" "${2:-5}" && [ "$(grep -o 'TEST: menu -\?[0-9]*' "$t_tmp/mh/duke3d.log" | tail -1)" = "TEST: menu $1" ]; }
up=0
for i in $(seq 1 90); do
    menu_is 0 1 && { up=1; break; }
    xdotool key --delay 100 a 2>/dev/null
    sleep 0.5
done
t_check "menu-host: the title menu is up" test "$up" = 1
xdotool key --delay 200 g; sleep 0.4; xdotool key --delay 200 Return
t_check "menu-host: HOST ONLINE opens menu 1600" menu_is 1600 10
xdotool key --delay 200 2; sleep 0.4; xdotool key --delay 200 Return
t_wait_for "$t_tmp/mh.out" 'mmulti: room code [A-Z0-9]{6}' 60
sleep 4
t_check "menu-host: the game re-launched itself with -nosetup" grep -Eq '^Re-launching: \S+ -allowsharewarenet -nosetup -net -relay .* -host-room 2 --' "$t_tmp/mh.out"
t_check "menu-host: the re-launched game made its room" grep -Eq 'mmulti: room code [A-Z0-9]{6}' "$t_tmp/mh.out"
t_check "menu-host: the startup window came up once, not again ($(windows mh))" test "$(windows mh)" = 1
kill -KILL "$game_pid" 2>/dev/null
t_result
