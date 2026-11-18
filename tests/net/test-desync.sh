#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# A deliberate desync is caught: the game's own sync check logs it, and -testdump shows the first
# tic at which the machines differ. Three headless games play a co-operative game through a local
# vnet relay; the second slave (player 2) is made to move its player 8 units in x at tic 300
# (-testnudge300: a nudge that is not an input, so only that machine sees it). Run twice:
#   with -testsync (a sync byte of the whole state every tic), and
#   without it (the game's own check: one byte every 8 tics of the players' positions, angles and the
#   random seed, which is what players have).
#
#   tests/net/test-desync.sh [--game FILE] [--mutate none|nolog]
#
# Passes when, in both runs: every game exits 0 (a desync does not stop it); the master and player 2
# log "GAME OUT OF SYNC: sync check N (tic T), player 2 differs from the master", with T within 1
# tic (-testsync) or 8 tics (own check) of the nudge or just after it; player 1, whose sync bytes
# are the master's and its own, never logs one (only the machines that compare against the nudged
# one do: code-facts.md 2.5); the -testdump of player 2 first differs from the host's at record 300,
# in the players part (and nothing else yet), and the dumps of the host and player 1 are identical.
# About 40 s.
#
# --mutate nolog: the "does it bite" proof, for the log: the run is made with the game's out-of-sync
# log switched off in a copy of the source (tests/net/lib.sh does not do that: give --game a binary
# built with netgame.c's NetSyncDiffers() not printing) and this test must FAIL.
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

rport=$((port_base + 80))
tics=450; nudge=300; limit=$((tics / 20 + 60))
t_start_relay "$rport"

run() {   # NAME EXTRA-ARGS: three players, player 2 nudged
    local name="$1" extra="$2" n code pids=() st
    local common="-v1 -l1 -c2 $extra -testquit$tics -testdumpd.bin"
    t_game "$name-p0" "$t_tmp/$name/p0" --game "$game" --timeout "$limit" -- -net -relay "127.0.0.1:$rport" -host-room 3 -- $common
    pids+=("$game_pid")
    t_wait_for "$t_tmp/$name/p0/duke3d.log" 'room code [A-Z0-9]{6}' 20 || { t_bad "$name: the host never printed a room code"; return; }
    code="$(grep -o 'room code [A-Z0-9]*' "$t_tmp/$name/p0/duke3d.log" | head -1 | awk '{print $3}')"
    t_game "$name-p1" "$t_tmp/$name/p1" --game "$game" --timeout "$limit" -- -net -relay "127.0.0.1:$rport" -room "$code" -- $common
    pids+=("$game_pid")
    # the slot a joiner takes is the order its first ping reaches the master: let player 1 in first
    t_wait_for "$t_tmp/$name/p0/duke3d.log" 'mmulti: Player 1 is here' 20 || { t_bad "$name: player 1 did not join"; return; }
    t_game "$name-p2" "$t_tmp/$name/p2" --game "$game" --timeout "$limit" -- -net -relay "127.0.0.1:$rport" -room "$code" -- $common -testnudge$nudge
    pids+=("$game_pid")
    for n in 0 1 2; do
        t_wait_pid "${pids[$n]}" $((limit + 10)); st=$t_status
        t_check "$name: player $n exited 0 (got $st)" test "$st" -eq 0
    done
}

check_run() {   # NAME WINDOW (the sync check's tic must be in [nudge, nudge+WINDOW])
    local name="$1" win="$2" d="$t_tmp/$1" n line tic
    for n in 0 2; do
        line="$(grep -h -m1 '^GAME OUT OF SYNC' "$d/p$n/duke3d.log" 2>/dev/null)"
        tic="$(echo "$line" | sed -n 's/.*(tic \([0-9]*\)).*/\1/p')"
        t_check "$name: player $n logged the desync, at tic ${tic:-?} (want $nudge to $((nudge + win))): ${line:-nothing}" \
            bash -c "[ -n '$tic' ] && [ '$tic' -ge $nudge ] && [ '$tic' -le $((nudge + win)) ] && echo '$line' | grep -q 'player 2 differs from the master'"
    done
    t_check "$name: player 1 logged none" bash -c "! grep -q 'OUT OF SYNC' '$d/p1/duke3d.log'"
    t_check "$name: player 2 played the nudge (TEST: nudging player 2 at tic $nudge)" grep -q "^TEST: nudging player 2 at tic $nudge\$" "$d/p2/duke3d.log"
    local diff02 diff01
    diff02="$("$root/tests/tools/testdump.py" diff "$d/p0/d.bin" "$d/p2/d.bin" 2>&1)"
    diff01="$("$root/tests/tools/testdump.py" diff "$d/p0/d.bin" "$d/p1/d.bin" 2>&1)"
    t_check "$name: the dumps of the host and player 2 first differ at record $nudge, in the players (got: $diff02)" \
        test "$diff02" = "first difference at record $nudge (tic $nudge): players"
    t_check "$name: the dumps of the host and player 1 are the same (got: $diff01)" test "$diff01" = "same: $tics records"
}

t_note "with -testsync (a sync byte of the whole state every tic), player 2 nudged at tic $nudge"
run sync "-testsync"
check_run sync 2
t_note "without it (the game's own check: a byte every 8 tics)"
run own ""
check_run own 16

t_result
