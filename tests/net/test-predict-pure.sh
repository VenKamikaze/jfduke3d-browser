#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# A1: the prediction of the local player's moves (fakedomovethings(), game.c) never changes the real
# simulation. Headless co-op games play E1L1 over the network for 450 tics; every player holds fire and
# walks about in a pattern (-testfire: so that the predicted moves are not all standing still), and
# every machine checks every call of the prediction (-testpredict): the raw bytes of every table of the
# simulation (ps[], sprite[], hittype[], sector[], wall[], ud, the sprite lists, the random seed, ...) are
# hashed just before and just after it (testhooks.c).
#
#   tests/net/test-predict-pure.sh [--game FILE]
#
# Passes when, on every machine: the game exits 0; the line "TEST: prediction: N predicted moves checked,
# M changed the simulation" has N of at least 400 and M of 0; no "changed the simulation" line; no desync;
# the -testdump files are the same on every machine. Two games: 3 players over a relay, 2 players over UDP.
# About 40 s.
#
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

game="$root/duke3d"; tics=450
while [ $# -gt 0 ]; do
    case "$1" in
        --game) game="$2"; shift 2 ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
    esac
done
t_need_data

rport=$((port_base + 120)); uport=$((port_base + 130)); limit=$((tics / 20 + 60))
common="-v1 -l1 -c2 -testsync -testquit$tics -testdumpd.bin -testfire150 -testpredict"
t_start_relay "$rport"

run() {   # NAME MODE PLAYERS
    local name="$1" mode="$2" players="$3" d="$t_tmp/$1" pids=() n code st line checked changed
    t_note "$name: $players players over $mode, $tics tics, every machine checks every prediction"
    if [ "$mode" = relay ]; then
        t_game p0 "$d/p0" --game "$game" --timeout "$limit" -- -net -relay "127.0.0.1:$rport" -host-room "$players" -- $common
        pids+=("$game_pid")
        t_wait_for "$d/p0/duke3d.log" 'room code [A-Z0-9]{6}' 20 || { t_bad "$name: the host never printed a room code"; return; }
        code="$(grep -o 'room code [A-Z0-9]*' "$d/p0/duke3d.log" | head -1 | awk '{print $3}')"
        for n in $(seq 1 $((players - 1))); do
            t_game "p$n" "$d/p$n" --game "$game" --timeout "$limit" -- -net -relay "127.0.0.1:$rport" -room "$code" -- $common
            pids+=("$game_pid")
            t_wait_for "$d/p0/duke3d.log" "mmulti: Player $n is here" 20 || { t_bad "$name: player $n did not join"; return; }
        done
    else
        t_game p0 "$d/p0" --game "$game" --timeout "$limit" -- -net "-nm:$players" "-p$uport" -- $common
        pids+=("$game_pid")
        sleep 1
        for n in $(seq 1 $((players - 1))); do
            t_game "p$n" "$d/p$n" --game "$game" --timeout "$limit" -- -net -nm "-p$((uport + n))" "127.0.0.1:$uport" -- $common
            pids+=("$game_pid")
        done
    fi
    for n in $(seq 0 $((players - 1))); do
        t_wait_pid "${pids[$n]}" $((limit + 15)); st=$t_status
        t_check "$name: player $n exited 0 (got $st)" test "$st" -eq 0
        local log="$d/p$n/duke3d.log"
        line="$(grep -h '^TEST: prediction: ' "$log" | tail -1)"
        checked="$(echo "$line" | sed -n 's/^TEST: prediction: \([0-9]*\) predicted moves checked, \([0-9]*\) changed.*/\1/p')"
        changed="$(echo "$line" | sed -n 's/^TEST: prediction: \([0-9]*\) predicted moves checked, \([0-9]*\) changed.*/\2/p')"
        t_check "$name: player $n checked ${checked:-?} predicted moves (at least 400) and ${changed:-?} changed the simulation (want 0)" test "${checked:-0}" -ge 400 -a "${changed:-1}" -eq 0
        t_check "$name: player $n logged no change of the simulation by the prediction" bash -c "! grep -q 'changed the simulation:' '$log'"
        t_check "$name: player $n logged no desync" bash -c "! grep -q 'OUT OF SYNC' '$log'"
        [ "$n" -gt 0 ] && t_check "$name: player $n's -testdump is the same as the host's" cmp -s "$d/p0/d.bin" "$d/p$n/d.bin"
    done
    if [ "$t_fail" -ne 0 ] && [ -n "${JFDUKE3D_TEST_VERBOSE:-}" ]; then
        for n in $(seq 0 $((players - 1))); do echo "---- p$n log"; grep '^TEST\|OUT OF SYNC' "$d/p$n/duke3d.log" | head -20; done
    fi
}

run relay-3 relay 3
run udp-2 udp 2
t_result
