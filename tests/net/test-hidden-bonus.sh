#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Brief 05: a hidden browser tab does not hold up the room at a level end. In Duke only a deathmatch
# level end waits for a key (dobonus()'s totals table, userack(): code-facts.md 4; co-op returns at
# once), and a hidden tab cannot be given one. A hidden tab in a network game now leaves userack() at
# once. Natively a hidden tab is imitated by -testnodraw (src/netgame.c NetHiddenTab(): no picture, the
# inputs and the moves are made by HiddenNetPass()). Every machine of a headless two player DUKEMATCH
# (-c1) plays E1L1 with -testnodraw; at tic 200 the level ends (-testexit200, player.c's own writer of
# MODE_EOL, so every machine goes through dobonus() and its totals table) and E1L2 is played for 300
# tics. Over a relay and over plain UDP.
#
#   tests/net/test-hidden-bonus.sh [--game FILE] [--only relay|udp]
#
# Passes when: every machine exits 0 within the time limit; each logs that it left the totals table by
# itself; the -testdump files are byte for byte the same (500 records, the 201st is tic 1 of the next
# level); no desync. Without the userack() change every machine waits at the table for a key that nobody
# can press and the game ends only with the time limit (exit 124). About 40 s.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

game="$root/duke3d"; only=""
while [ $# -gt 0 ]; do
    case "$1" in
        --game|--sw) game="$2"; shift 2 ;;
        --only) only="$2"; shift 2 ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
    esac
done
t_need_data

exit_tic=200; tics=300; limit=60
rport=$((port_base + 120)); uport=$((port_base + 125))
common="-v1 -l1 -c1 -testsync -testquit$tics -testdumpd.bin -testexit$exit_tic -testnodraw"
t_start_relay "$rport"

run() {
    local mode="$1" d="$t_tmp/$1" pids=() st n code
    t_note "$mode: two hidden players, a deathmatch ending at tic $exit_tic (load $(cut -d' ' -f1-3 /proc/loadavg))"
    if [ "$mode" = relay ]; then
        t_game p0 "$d/p0" --game "$game" --timeout "$limit" -- -net -relay "127.0.0.1:$rport" -host-room 2 -- $common
        pids+=("$game_pid")
        t_wait_for "$d/p0/duke3d.log" 'room code [A-Z0-9]{6}' 20 || { t_bad "$mode: the host never printed a room code"; return; }
        code="$(grep -o 'room code [A-Z0-9]*' "$d/p0/duke3d.log" | head -1 | awk '{print $3}')"
        t_game p1 "$d/p1" --game "$game" --timeout "$limit" -- -net -relay "127.0.0.1:$rport" -room "$code" -- $common
        pids+=("$game_pid")
    else
        t_game p0 "$d/p0" --game "$game" --timeout "$limit" -- -net -nm:2 "-p$uport" -- $common
        pids+=("$game_pid")
        sleep 1
        t_game p1 "$d/p1" --game "$game" --timeout "$limit" -- -net -nm "-p$((uport + 1))" "127.0.0.1:$uport" -- $common
        pids+=("$game_pid")
    fi
    for n in 0 1; do
        t_wait_pid "${pids[$n]}" $((limit + 15)); st=$t_status
        t_check "$mode: player $n exited 0 (got $st; 124 is a hang at the totals table)" test "$st" -eq 0
        t_check "$mode: player $n left the totals table by itself" grep -q "this tab is hidden, so it leaves the screen by itself" "$d/p$n/duke3d.log"
        t_check "$mode: player $n ended the level at tic $exit_tic" grep -q "^TEST: ending the level at tic $exit_tic " "$d/p$n/duke3d.log"
        t_check "$mode: player $n logged no desync" bash -c "! grep -q 'OUT OF SYNC' '$d/p$n/duke3d.log'"
    done
    local size0 next
    size0="$(stat -c %s "$d/p0/d.bin" 2>/dev/null || echo 0)"
    next="$(od -An -tu4 -j $((exit_tic * 32)) -N4 "$d/p0/d.bin" 2>/dev/null | tr -d ' ')"
    t_check "$mode: the dump has $exit_tic tics of the first level and $tics of the next ($((size0 / 32)) records; record $((exit_tic + 1)) is tic ${next:-?})" test "$size0" -eq $(((exit_tic + tics) * 32)) -a "${next:-0}" = 1
    t_check "$mode: both dumps are the same ($("$root/tests/tools/testdump.py" diff "$d/p0/d.bin" "$d/p1/d.bin" 2>&1 | head -1))" cmp -s "$d/p0/d.bin" "$d/p1/d.bin"
}

[ -z "$only" -o "$only" = relay ] && run relay
[ -z "$only" -o "$only" = udp ] && run udp
t_result
