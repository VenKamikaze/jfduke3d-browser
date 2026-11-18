#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# A relay session lost during a game ends the game with a clear message and exit status 1, instead of
# standing still for ever (jfSW's L18, the game's half; the engine already says "the relay session was
# lost" and keeps a FAILED state). Two headless games play through a local relay that drops a member
# silent for 3 s (-session-timeout 3s -keepalive 1s); the joiner's game process is stopped (SIGSTOP)
# for 7 s in the middle of the game, so the relay drops its session, then it carries on (SIGCONT).
#
#   tests/net/test-relay-lost.sh [--game FILE]
#
# Passes when the joiner: prints "mmulti: the relay session was lost"; ends with "Network game failed:
# the relay ended the session (...)" and exit status 1 within 20 s of being resumed (and not before: the
# game was running). The host is left to stall (the other players are not told: a host that vanishes
# still stalls the rest, as in jfSW) and is stopped by the test. About 40 s. (NetLostCheck() also runs in
# waitforeverybody(), for a session lost between levels; that case has no test of its own.)
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

game="$root/duke3d"
while [ $# -gt 0 ]; do
    case "$1" in
        --game) game="$2"; shift 2 ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
    esac
done
t_need_data

rport=$((port_base + 100))
t_start_relay "$rport" -session-timeout 3s -keepalive 1s

t_game host "$t_tmp/host" --game "$game" --timeout 120 -- -net -relay "127.0.0.1:$rport" -host-room 2 -- -v1 -l1 -c2 -testdumpd.bin
hostpid=$game_pid
t_wait_for "$t_tmp/host/duke3d.log" 'room code [A-Z0-9]{6}' 20 || t_bad "the host printed no room code"
code="$(grep -o 'room code [A-Z0-9]*' "$t_tmp/host/duke3d.log" | head -1 | awk '{print $3}')"
t_game joiner "$t_tmp/joiner" --game "$game" --timeout 120 -- -net -relay "127.0.0.1:$rport" -room "$code" -- -v1 -l1 -c2 -testdumpd.bin
joinpid=$game_pid
t_wait_for "$t_tmp/joiner/duke3d.log" 'TEST: writing the tic dump' 40 || t_bad "the joiner never started the game"
# it is in the game: let it run for a few seconds
sleep 4
gamepid="$(pgrep -P "$joinpid" -x duke3d | head -1)"
[ -n "$gamepid" ] || { t_bad "could not find the joiner's game process"; t_result; }
tics0=$(( $(stat -c %s "$t_tmp/joiner/d.bin") / 32 ))
t_check "the joiner's game is running ($tics0 tics so far)" test "$tics0" -gt 30
kill -STOP "$gamepid"; sleep 7; kill -CONT "$gamepid"
t0=$(date +%s.%N)
t_wait_pid "$joinpid" 40; st=$t_status
took=$(echo "$(date +%s.%N) - $t0" | bc)
t_check "the joiner exited 1 (got $st) ${took}s after being resumed (at most 20 s)" bash -c "[ $st -eq 1 ] && [ \$(echo '$took <= 20' | bc) -eq 1 ]"
t_check "the joiner said the session was lost: $(grep -h -m1 'relay session was lost' "$t_tmp/joiner/duke3d.log" 2>/dev/null)" grep -q 'mmulti: the relay session was lost' "$t_tmp/joiner/duke3d.log"
t_check "the joiner ended with the reason: $(grep -h -m1 '^Network game failed' "$t_tmp/joiner/duke3d.log" 2>/dev/null)" grep -q '^Network game failed: the relay ended the session' "$t_tmp/joiner/duke3d.log"
tics1=$(( $(stat -c %s "$t_tmp/joiner/d.bin") / 32 ))
t_check "it was in the game when the session was lost ($tics1 tics played)" test "$tics1" -gt 30
kill -TERM "$hostpid" 2>/dev/null; t_wait_pid "$hostpid" 15

t_result
