#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Brief 04 fix round: a multiplayer save game (input bit 17, saveplayer(): menues.c) calls waitforeverybody() without
# clearing the input queues (clearfifo()), so a barrier alone is not a level change, and the players' inputs that are in
# flight during it belong to the tics after the save. The D11 fix (a master drops a slave's input while the slave's
# ready counter is behind its own) must act only for a barrier that follows clearfifo(); the first version of it did
# not, and dropped those inputs: the inputs are delta coded and carry no tic number, so everything after shifted.
# A save is asked for at tic 100 (-testsave100, on one machine), the players hold fire and walk about (-testfire1),
# 500 tics. Scenarios: relay-master, relay-slave, udp-slave (who saves).
#
#   tests/net/test-save.sh [--game FILE] [--only NAME]
#
# Passes when every game exits 0, logs no desync, the saving machine logs its request, every machine writes a save
# file, and the -testdump files are byte for byte the same.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

game="$root/duke3d"; only=()
while [ $# -gt 0 ]; do
    case "$1" in
        --game) game="$2"; shift 2 ;;
        --only) only+=("$2"); shift 2 ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
    esac
done
t_need_data
[ ${#only[@]} -eq 0 ] && only=(relay-master relay-slave udp-slave)

tics=500; limit=90; rport=$((port_base + 300)); uport=$((port_base + 310))
common="-v1 -l1 -c2 -testsync -testquit$tics -testdumpd.bin -testfire1"
t_start_relay "$rport"

run() {
    local name="$1" d="$t_tmp/$1" mode who pids=() n code st
    case "$name" in
        relay-master) mode=relay; who=0 ;;
        relay-slave)  mode=relay; who=1 ;;
        udp-slave)    mode=udp;   who=1 ;;
    esac
    t_note "$name: 2 players over $mode, player $who asks for a save at tic 100 (load $(cut -d' ' -f1-3 /proc/loadavg))"
    extra() { [ "$1" = "$who" ] && echo "-testsave100"; }
    if [ "$mode" = relay ]; then
        t_game p0 "$d/p0" --game "$game" --timeout "$limit" -- -net -relay "127.0.0.1:$rport" -host-room 2 -- $common $(extra 0)
        pids+=("$game_pid")
        t_wait_for "$d/p0/duke3d.log" 'room code [A-Z0-9]{6}' 20 || { t_bad "$name: no room code"; return; }
        code="$(grep -o 'room code [A-Z0-9]*' "$d/p0/duke3d.log" | head -1 | awk '{print $3}')"
        t_game p1 "$d/p1" --game "$game" --timeout "$limit" -- -net -relay "127.0.0.1:$rport" -room "$code" -- $common $(extra 1)
        pids+=("$game_pid")
    else
        t_game p0 "$d/p0" --game "$game" --timeout "$limit" -- -net -nm:2 "-p$uport" -- $common $(extra 0)
        pids+=("$game_pid"); sleep 1
        t_game p1 "$d/p1" --game "$game" --timeout "$limit" -- -net -nm "-p$((uport + 1))" "127.0.0.1:$uport" -- $common $(extra 1)
        pids+=("$game_pid")
    fi
    for n in 0 1; do
        t_wait_pid "${pids[$n]}" $((limit + 15)); st=$t_status
        t_check "$name: player $n exited 0 (got $st)" test "$st" -eq 0
        t_check "$name: player $n logged no desync" bash -c "! grep -q 'OUT OF SYNC' '$d/p$n/duke3d.log'"
        t_check "$name: player $n wrote a save file ($(ls "$d/p$n" | grep -ci '\.sav') files)" bash -c "ls '$d/p$n' | grep -qi '\.sav'"
    done
    t_check "$name: player $who asked for the save" grep -q '^TEST: asking for a multiplayer save' "$d/p$who/duke3d.log"
    t_check "$name: the dumps have $tics records each" test "$(stat -c %s "$d/p0/d.bin")" -eq $((tics * 32)) -a "$(stat -c %s "$d/p1/d.bin")" -eq $((tics * 32))
    t_check "$name: player 1's dump is the same as the master's ($("$root/tests/tools/testdump.py" diff "$d/p0/d.bin" "$d/p1/d.bin" 2>&1 | head -1))" cmp -s "$d/p0/d.bin" "$d/p1/d.bin"
    if [ "$t_fail" -ne 0 ] && [ -n "${JFDUKE3D_TEST_VERBOSE:-}" ]; then
        for n in 0 1; do echo "---- p$n log"; grep '^TEST\|OUT OF SYNC' "$d/p$n/duke3d.log" | head -12; done
    fi
}

for s in "${only[@]}"; do run "$s"; done

# the test flags together would overflow the version byte of the player announcement (134 + 123 > 255): refused at once
if [ ${#only[@]} -ge 3 ]; then
    t_note "all the test flags at once"
    fl="-v1 -l1 -c2 -testsync -testexit50 -testfire -testarm -testcam5,0 -testmirror5,0"
    t_game f0 "$t_tmp/f0" --game "$game" --timeout 40 -- -net -relay "127.0.0.1:$rport" -host-room 2 -- $fl
    h0=$game_pid
    t_wait_for "$t_tmp/f0/duke3d.log" 'room code [A-Z0-9]{6}' 20
    code="$(grep -o 'room code [A-Z0-9]*' "$t_tmp/f0/duke3d.log" | head -1 | awk '{print $3}')"
    t_game f1 "$t_tmp/f1" --game "$game" --timeout 40 -- -net -relay "127.0.0.1:$rport" -room "$code" -- $fl
    t_wait_pid "$game_pid" 50; s1=$t_status
    t_wait_pid "$h0" 50; s0=$t_status
    t_check "too many test flags: both exit with status 1 (got $s0 and $s1)" test "$s0" -eq 1 -a "$s1" -eq 1
    t_check "too many test flags: the host says why (the joiner then loses it)" grep -q 'too many test options' "$t_tmp/f0.out"
fi
t_result
