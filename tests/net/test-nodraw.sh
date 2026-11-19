#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Brief 04 (the drawing-state audit, code-facts.md section 20): a machine that draws nothing, as a hidden browser tab
# does (-testnodraw: the main loop calls HiddenNetPass() instead of displayrooms(), displayrest() and nextpage()),
# plays the same game as machines that do draw. Three players over a relay, the middle one without a picture, in a game
# that goes where drawing writes to the simulation's tables:
#   camera    every player is put in front of a security monitor at tic 20 and presses the use key: the monitor switches
#             to its camera, and every machine that draws counts frames in the monitor's hittype temp_data[0]
#             (animatecamsprite(), sector.c) and may overwrite its owner; the machine that does not draw does neither
#   mirror    every player is put in front of a mirror and fires the RPG from tic 80 on: the drawing machines draw the
#             mirror (preparemirror, completemirror, a second drawrooms()), then the rockets break it
#
#   tests/net/test-nodraw.sh [--game FILE] [--only camera|mirror|both]
#
# Passes when, in each scenario: every game exits 0 and logs no desync; the placement and its effect are logged by
# every machine (the monitor switched to its camera, camsprite set; the mirror broken); the machines that draw log
# that drawing wrote the monitor's counter (-testdrawcheck on them: "hittype[N] at byte 48") and the one that does not
# draw logs no draw check at all; the -testdump files are byte for byte the same and the state dumps agree field for
# field at tics 1, 2 and the last. About 40 s a scenario.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

game="$root/duke3d"; only=(camera mirror)
while [ $# -gt 0 ]; do
    case "$1" in
        --game) game="$2"; shift 2 ;;
        --only) case "$2" in both) only=(camera mirror) ;; *) only=("$2") ;; esac; shift 2 ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
    esac
done
t_need_data

tics=400; limit=90; players=3; nodraw=1
rport=$((port_base + 200))
t_start_relay "$rport"

run() {
    local name="$1" d="$t_tmp/$1" pids=() n code st hook common
    case "$name" in
        camera) hook="-testcam20,0" ;;
        mirror) hook="-testmirror20,0" ;;
    esac
    common="-v1 -l1 -c2 -testsync -testquit$tics -testdumpd.bin -teststate -teststate$tics $hook"
    t_note "$name: $players players over a relay, player $nodraw draws nothing (load $(cut -d' ' -f1-3 /proc/loadavg))"
    extra() { if [ "$1" = "$nodraw" ]; then echo "-testnodraw"; else echo "-testdrawcheck"; fi; }
    t_game p0 "$d/p0" --game "$game" --timeout "$limit" -- -net -relay "127.0.0.1:$rport" -host-room "$players" -- $common $(extra 0)
    pids+=("$game_pid")
    t_wait_for "$d/p0/duke3d.log" 'room code [A-Z0-9]{6}' 20 || { t_bad "$name: the host never printed a room code"; return; }
    code="$(grep -o 'room code [A-Z0-9]*' "$d/p0/duke3d.log" | head -1 | awk '{print $3}')"
    for n in $(seq 1 $((players - 1))); do
        t_game "p$n" "$d/p$n" --game "$game" --timeout "$limit" -- -net -relay "127.0.0.1:$rport" -room "$code" -- $common $(extra "$n")
        pids+=("$game_pid")
        t_wait_for "$d/p0/duke3d.log" "mmulti: Player $n is here" 20 || { t_bad "$name: player $n did not join"; return; }
    done
    for n in $(seq 0 $((players - 1))); do
        t_wait_pid "${pids[$n]}" $((limit + 15)); st=$t_status
        t_check "$name: player $n exited 0 (got $st)" test "$st" -eq 0
    done
    for n in $(seq 0 $((players - 1))); do
        local log="$d/p$n/duke3d.log"
        t_check "$name: player $n logged no desync" bash -c "! grep -q 'OUT OF SYNC' '$log'"
        t_check "$name: player $n placed the players" grep -q '^TEST: go: players placed' "$log"
        case "$name" in
            camera) t_check "$name: player $n's monitor switched to its camera ($(grep '^TEST: go: monitor sprite' "$log" | cut -c1-90))" grep -q '^TEST: go: monitor sprite [0-9]*: yvel 1 .*camsprite [0-9]' "$log" ;;
            mirror) t_check "$name: player $n's mirror broke" grep -q '^TEST: go: mirror wall [0-9]*: overpicnum 70 ' "$log" ;;
        esac
        if [ "$n" = "$nodraw" ]; then
            t_check "$name: player $n (no picture) logged no draw check" bash -c "! grep -q 'draw check' '$log'"
        else
            t_check "$name: player $n (drawing) saw what drawing writes to the tables ($(grep -c 'draw check: display.* writes' "$log") fields)" grep -q 'draw check: displayrooms writes' "$log"
            if [ "$name" = camera ]; then
                t_check "$name: player $n's drawing wrote the monitor's frame counter (hittype temp_data[0])" grep -q 'draw check: displayrooms writes hittype\[[0-9]*\] at byte 48' "$log"
            fi
        fi
    done
    local size0
    size0="$(stat -c %s "$d/p0/d.bin" 2>/dev/null || echo 0)"
    t_check "$name: the master's dump has $tics records ($((size0 / 32)))" test "$size0" -eq $((tics * 32))
    for n in $(seq 1 $((players - 1))); do
        t_check "$name: player $n's dump is the same as the master's ($("$root/tests/tools/testdump.py" diff "$d/p0/d.bin" "$d/p$n/d.bin" 2>&1 | head -1))" cmp -s "$d/p0/d.bin" "$d/p$n/d.bin"
        for t in 1 2 $tics; do
            awk -v T="t$t" '/^t[0-9]+ randomseed=/ { on = ($1 == T) } on' "$d/p0/d.bin.state" > "$d/p0.t$t"
            awk -v T="t$t" '/^t[0-9]+ randomseed=/ { on = ($1 == T) } on' "$d/p$n/d.bin.state" > "$d/p$n.t$t"
            t_check "$name: player $n's state agrees with the master's field for field at tic $t ($(wc -l < "$d/p0.t$t") lines)" bash -c "[ -s '$d/p0.t$t' ] && cmp -s '$d/p0.t$t' '$d/p$n.t$t'"
        done
    done
    if [ "$t_fail" -ne 0 ] && [ -n "${JFDUKE3D_TEST_VERBOSE:-}" ]; then
        for n in $(seq 0 $((players - 1))); do echo "---- p$n log"; grep '^TEST\|OUT OF SYNC' "$d/p$n/duke3d.log" | head -20; done
    fi
}

for s in "${only[@]}"; do run "$s"; done
t_result
