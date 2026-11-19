#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# A1 (bugs.md D5, D6): when a level ends in a network game, every machine plays exactly the tics up to
# the one that ended it, and all of them leave it. Headless co-op games play E1L1; at tic 200 the level
# ends the way a level-end sector ends it (-testexit200: player.c's own writer of MODE_EOL, run inside
# the tic on every machine), then 300 tics of E1L2 (-testquit300). Every player holds fire with the
# chaingun and walks about in a pattern (-testfire150: the ammo carried into the next level changes
# every few tics, and a stale or missing input would move a player somewhere else), and one machine
# stops for 1.5 s at tic 190 (-teststall190,1500), ten tics before the end, with the others going on.
# Scenarios (what each shows, in the unfixed game):
#   slave-stall    a slave stops: when it comes back it sends the master 45 inputs at once, the master
#                  plays them all (the exit tic among them) before it forwards them, and leaves the level
#                  with the slaves' last tics unsent: they never leave it and every machine hangs (D6)
#   master-stall   the master stops (relay: the joiners' datagrams are 200 ms late as well): it comes back
#                  with the inputs of more tics queued than the slaves have and plays them after the exit
#                  tic, the slaves a different number: different ammo carried into the next level and
#                  "GAME OUT OF SYNC" there (D5, jfSW's L20)
#
#   late-slave     (brief 04, bugs.md D11) a slave makes its input for tic 201, the first after the exit, and then stops for
#                  1.5 s before it sends it: its inputs for the tics after the level's last one reach the master after the
#                  master has left the level and cleared its queues. Unfixed, the master appends them to the new level's
#                  queue as the inputs of its first tics (inputs carry no tic number), and the slave plays its own fresh
#                  inputs there: the slave's player is somewhere else on the master and the other slave than on the slave
#
#   tests/net/test-level-exit.sh [--game FILE] [--runs N] [--only NAME] [--mpp 2|4]
#       names: relay-slave, relay-master, relay-3, udp-slave, udp-master, udp-3, relay-late, udp-late
#       (--only may be given several times; the default is the first six; the two late ones are in the default too since brief 04)
#
# Passes when, in every run of a scenario: every game exits 0 (a hang is killed after 60 s: exit 124);
# every machine logs that the level was ended at tic 200 and left after tic 200, and the stalled one logs
# its stall; the machine that had the most inputs queued (the master) had those of at least 2 more tics
# when it left, so that the unfixed game would have played them; the -testdump files (testhooks.c: 32
# bytes a tic) are byte for byte the same, 500 records, the 201st of which is tic 1 of the next level; the
# state dumps (-teststate) of every machine agree field for field at the next level's start and at its
# tic 300; the players spent ammo before the exit and after it; no machine logs "OUT OF SYNC".
# About 25 s a scenario.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

game="$root/duke3d"; runs=1; only=(); mpp=""
while [ $# -gt 0 ]; do
    case "$1" in
        --game) game="$2"; shift 2 ;;
        --runs) runs="$2"; shift 2 ;;
        --only) only+=("$2"); shift 2 ;;
        --mpp) mpp=" -f$2"; shift 2 ;;      # 04b: movesperpacket 2 or 4 on every machine
        *) echo "unknown option $1" >&2; exit 2 ;;
    esac
done
t_need_data
[ ${#only[@]} -eq 0 ] && only=(relay-slave relay-master relay-3 udp-slave udp-master udp-3 relay-late udp-late)

exit_tic=200; stall_tic=190; tics=300; limit=60
rport=$((port_base + 100)); uport=$((port_base + 110))
common="-v1 -l1 -c2 -testsync -testquit$tics -testdumpd.bin -teststate -teststate$tics -testexit$exit_tic -testfire150$mpp"
t_start_relay "$rport"

# block TIC LEVEL FILE: the state dump's block of the given tic of the given level
block() {
    awk -v T="t$1" -v L="level=$2" '/^t[0-9]+ randomseed=/ { on = ($1 == T && $3 == L) } on' "$3"
}

# run NAME: one game of the scenario NAME (relay-slave, ...)
run() {
    local name="$1" run="$2" mode players who impair
    case "$name" in
        relay-slave)  mode=relay; players=2; who=1; impair="" ;;
        relay-master) mode=relay; players=2; who=0; impair="lat=200" ;;
        relay-3)      mode=relay; players=3; who=2; impair="lat=60" ;;
        udp-slave)    mode=udp;   players=2; who=1; impair="" ;;
        udp-master)   mode=udp;   players=2; who=0; impair="" ;;
        udp-3)        mode=udp;   players=3; who=1; impair="" ;;
        relay-late)   mode=relay; players=3; who=2; impair="" ;;
        udp-late)     mode=udp;   players=3; who=2; impair="" ;;
    esac
    late=0; case "$name" in *-late) late=1 ;; esac
    local tag="$name/$run" d="$t_tmp/$name-$run" pids=() n code st more next
    t_note "$tag: $players players over ${mode}, player $who $([ "$late" = 1 ] && echo "holds its input of tic $((exit_tic + 1)) for 1.5 s" || echo "stops 1.5 s at tic $stall_tic")${impair:+, datagrams of the joiners $impair}; the level ends at tic $exit_tic (load $(cut -d' ' -f1-3 /proc/loadavg))"
    if [ "$late" = 1 ]; then
        extra() { [ "$1" = "$who" ] && echo "-testlate$((exit_tic + 1)),1500"; }
    else
        extra() { [ "$1" = "$who" ] && echo "-teststall$stall_tic,1500"; }
    fi
    if [ "$mode" = relay ]; then
        t_game p0 "$d/p0" --game "$game" --timeout "$limit" -- -net -relay "127.0.0.1:$rport" -host-room "$players" -- $common $(extra 0)
        pids+=("$game_pid")
        t_wait_for "$d/p0/duke3d.log" 'room code [A-Z0-9]{6}' 20 || { t_bad "$tag: the host never printed a room code"; return; }
        code="$(grep -o 'room code [A-Z0-9]*' "$d/p0/duke3d.log" | head -1 | awk '{print $3}')"
        for n in $(seq 1 $((players - 1))); do
            VNET_IMPAIR="${impair:+$impair,seed=$((n + run))}" t_game "p$n" "$d/p$n" --game "$game" --timeout "$limit" -- -net -relay "127.0.0.1:$rport" -room "$code" -- $common $(extra "$n")
            pids+=("$game_pid")
            # the slot a joiner takes is the order its first ping reaches the master
            t_wait_for "$d/p0/duke3d.log" "mmulti: Player $n is here" 20 || { t_bad "$tag: player $n did not join"; return; }
        done
    else
        t_game p0 "$d/p0" --game "$game" --timeout "$limit" -- -net "-nm:$players" "-p$uport" -- $common $(extra 0)
        pids+=("$game_pid")
        sleep 1
        for n in $(seq 1 $((players - 1))); do
            t_game "p$n" "$d/p$n" --game "$game" --timeout "$limit" -- -net -nm "-p$((uport + n))" "127.0.0.1:$uport" -- $common $(extra "$n")
            pids+=("$game_pid")
        done
    fi
    for n in $(seq 0 $((players - 1))); do
        t_wait_pid "${pids[$n]}" $((limit + 15)); st=$t_status
        t_check "$tag: player $n exited 0 (got $st)" test "$st" -eq 0
    done
    for n in $(seq 0 $((players - 1))); do
        local log="$d/p$n/duke3d.log" played
        t_check "$tag: player $n ended the level at tic $exit_tic" grep -q "^TEST: ending the level at tic $exit_tic " "$log"
        played="$(sed -n 's/^TEST: left the level after tic \([0-9]*\), .*/\1/p' "$log" | head -1)"
        t_check "$tag: player $n played ${played:-?} tics of the first level (want $exit_tic)" test "${played:-0}" -eq "$exit_tic"
        t_check "$tag: player $n logged no desync" bash -c "! grep -q 'OUT OF SYNC' '$log'"
    done
    if [ "$late" = 1 ]; then
        t_check "$tag: player $who held its input of tic $((exit_tic + 1))" grep -q "^TEST: holding the input of tic $((exit_tic + 1)) for 1500 ms" "$d/p$who/duke3d.log"
    else
        t_check "$tag: player $who stalled" grep -q "^TEST: stalling for 1500 ms at tic $stall_tic\$" "$d/p$who/duke3d.log"
        # (the unfixed game plays those tics after the exit tic: this is what makes the scenario bite)
        more="$(sed -n 's/^TEST: left the level after tic [0-9]*, with the inputs of \(-\?[0-9]*\) more tics here.*/\1/p' "$d/p0/duke3d.log" | head -1)"
        t_check "$tag: the master had the inputs of ${more:-?} more tics when it left the first level (at least 2: the case the unfixed game got wrong)" test "${more:-0}" -ge 2
    fi
    local size0
    size0="$(stat -c %s "$d/p0/d.bin" 2>/dev/null || echo 0)"
    next="$(od -An -tu4 -j $((exit_tic * 32)) -N4 "$d/p0/d.bin" 2>/dev/null | tr -d ' ')"
    t_check "$tag: the master's dump has $exit_tic tics of the first level and $tics of the next ($((size0 / 32)) records; record $((exit_tic + 1)) is tic ${next:-?})" test "$size0" -eq $(((exit_tic + tics) * 32)) -a "${next:-0}" = 1
    for n in $(seq 1 $((players - 1))); do
        t_check "$tag: player $n's dump is the same as the master's ($("$root/tests/tools/testdump.py" diff "$d/p0/d.bin" "$d/p$n/d.bin" 2>&1 | head -1))" cmp -s "$d/p0/d.bin" "$d/p$n/d.bin"
        for when in "1 2" "$tics 2"; do
            set -- $when
            block "$1" "$2" "$d/p0/d.bin.state" > "$d/p0.t$1.l$2"
            block "$1" "$2" "$d/p$n/d.bin.state" > "$d/p$n.t$1.l$2"
            t_check "$tag: player $n's state agrees with the master's field for field at tic $1 of level $2 ($(wc -l < "$d/p0.t$1.l$2") lines)" bash -c "[ -s '$d/p0.t$1.l$2' ] && cmp -s '$d/p0.t$1.l$2' '$d/p$n.t$1.l$2'"
        done
    done
    local a0 a1
    a0="$(sed -n 's/^player 0 .* ammo_amount3=\([0-9]*\) .*/\1/p' "$d/p0.t1.l2")"
    a1="$(sed -n 's/^player 0 .* ammo_amount3=\([0-9]*\) .*/\1/p' "$d/p0.t$tics.l2")"
    t_check "$tag: player 0 spent chaingun ammo before the exit and after it (${a0:-?} at the next level's start, ${a1:-?} at its tic $tics; 300 to begin with)" test "${a0:-300}" -lt 300 -a "${a1:-999}" -lt "${a0:-0}"
    if [ "$t_fail" -ne 0 ] && [ -n "${JFDUKE3D_TEST_VERBOSE:-}" ]; then
        for n in $(seq 0 $((players - 1))); do echo "---- p$n log"; grep '^TEST\|OUT OF SYNC' "$d/p$n/duke3d.log" | head -20; done
    fi
}

for r in $(seq 1 "$runs"); do
    for s in "${only[@]}"; do run "$s" "$r"; done
done
t_result
