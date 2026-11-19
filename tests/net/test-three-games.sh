#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Two to four headless game processes play a co-operative game (E1L1, shareware GRP)
# over the network and each quits by itself after N game tics. Passes when none of
# them logs a desync, all exit 0, enough sync checks were made, and every machine's
# -testdump record of every tic is byte for byte the same.
#
#   tests/net/test-three-games.sh [options]
#
#   --relay          (default) through a local vnet relay: one process hosts
#                    a room for N (-net -relay 127.0.0.1:P -host-room N), the others
#                    join it by its room code
#   --udp            plain UDP (-net -nm:N / -net -nm HOST:PORT), no relay:
#                    the existing path, which must keep working
#   --tics N         game tics to play (default 900: 30 s at the game's 30 tics a second)
#   --players N      2 to 4 (default 3; the shareware GRP allows 4)
#   --game FILE      the game binary (default ./duke3d)
#   --impair SPEC    vnet impairment on every process (--relay only), e.g.
#                    "loss=5,dup=2,reorder=5,lat=20,jit=10"; each process gets
#                    its own "seed=" (the player number + 1)
#   --nudge N:T      test-only: process N (0 = host) moves its player 8 units
#                    at tic T (-testnudge): a deliberate desync that must make
#                    this test FAIL (see test-desync.sh, which expects it)
#   --no-testsync    leave -testsync out (one sync byte every 8 tics: the game's own check)
#   --nosound N      A1: process N (0 = host) runs with sound off (-ns) while the others have it: a game that
#                    played a sound (or not) must not play differently (jfSW's L27 pattern: sound-gated
#                    random numbers; code-facts.md 17)
#   --mpp N          04b: movesperpacket N (1, 2 or 4: -f2 / -f4 on every machine; the master and the slaves
#                    then exchange one packet per N tics)
#   --fire           A1: every player holds fire and walks about from tic 100 (-testfire), so that shots,
#                    hits and kills make sounds
#
# What counts, from each process's duke3d.log: exit status 0; the line
#   TEST: quitting after T game tics: C sync checks, M mismatches, sync every 1 tic, player I of P
# with T at least N and P equal to the player count; no "OUT OF SYNC"; and C at
# least N - 40 on every machine (every machine compares: the master each slave's
# byte against its own, a slave its own against the master's; the last few are
# still in flight when the game quits). Then the -testdump files (testhooks.c: 32
# bytes a tic: the tic, the random seed and the hashes of the players, the sprites,
# the hittype table, the sectors, the walls and the rest of the simulation) must have
# N records and be identical on every machine.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

mode=relay; tics=900; players=3; game="$root/duke3d"; impair=""; nudge=""; testsync="-testsync"; nosound=""; fire=""; mpp=""
while [ $# -gt 0 ]; do
    case "$1" in
        --relay) mode=relay; shift ;;
        --udp) mode=udp; shift ;;
        --tics) tics="$2"; shift 2 ;;
        --players) players="$2"; shift 2 ;;
        --game) game="$2"; shift 2 ;;
        --impair) impair="$2"; shift 2 ;;
        --nudge) nudge="$2"; shift 2 ;;
        --no-testsync) testsync=""; shift ;;
        --nosound) nosound="$2"; shift 2 ;;
        --mpp) mpp="-f$2"; shift 2 ;;
        --fire) fire="-testfire100"; shift ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
    esac
done
t_need_data

rport=$((port_base + 20))
uport=$((port_base + 30))
auto="-v1 -l1 -c2 $testsync -testquit$tics -testdumpd.bin $fire $mpp"
limit=$((tics / 20 + 60))      # seconds: a hang detector, generous for a loaded machine
every=1; [ -z "$testsync" ] && every=8

t_note "$players-player coop game, $tics tics, $mode${impair:+, impairment $impair}${nudge:+, nudge $nudge}${testsync:+, -testsync}${nosound:+, player $nosound without sound}${mpp:+, $mpp}${fire:+, firing and walking}"

game_args() {   # player index -> args after "--"
    local n="$1" a="$auto"
    [ -n "$nudge" ] && [ "${nudge%%:*}" = "$n" ] && a="$a -testnudge${nudge##*:}"
    [ -n "$nosound" ] && [ "$nosound" = "$n" ] && a="$a -ns"
    echo "$a"
}

pids=(); idx=""
if [ "$mode" = relay ]; then
    t_start_relay "$rport"
    wd0="$t_tmp/p0"
    VNET_IMPAIR="${impair:+$impair,seed=1}" t_game p0 "$wd0" --game "$game" --timeout "$limit" -- -net -relay "127.0.0.1:$rport" -host-room "$players" -- $(game_args 0)
    pids+=("$game_pid")
    t_wait_for "$wd0/duke3d.log" 'room code [A-Z0-9]{6}' 20 || { t_bad "the host never printed a room code"; cat "$t_tmp/p0.out"; t_result; }
    code="$(grep -o 'room code [A-Z0-9]*' "$wd0/duke3d.log" | head -1 | awk '{print $3}')"
    t_note "room code $code"
    for n in $(seq 1 $((players - 1))); do
        VNET_IMPAIR="${impair:+$impair,seed=$((n + 1))}" t_game "p$n" "$t_tmp/p$n" --game "$game" --timeout "$limit" -- -net -relay "127.0.0.1:$rport" -room "$code" -- $(game_args "$n")
        pids+=("$game_pid")
    done
else
    t_game p0 "$t_tmp/p0" --game "$game" --timeout "$limit" -- -net "-nm:$players" "-p$uport" -- $(game_args 0)
    pids+=("$game_pid")
    sleep 1
    for n in $(seq 1 $((players - 1))); do
        t_game "p$n" "$t_tmp/p$n" --game "$game" --timeout "$limit" -- -net -nm "-p$((uport + n))" "127.0.0.1:$uport" -- $(game_args "$n")
        pids+=("$game_pid")
    done
fi

for n in $(seq 0 $((players - 1))); do
    t_wait_pid "${pids[$n]}" $((limit + 10))
    st=$t_status
    log="$t_tmp/p$n/duke3d.log"
    t_check "player $n exited 0 (got $st)" test "$st" -eq 0
    line="$(grep -h '^TEST: quitting after' "$log" 2>/dev/null | tail -1)"
    reached="$(echo "$line" | sed -n 's/^TEST: quitting after \([0-9]*\) game tics:.* sync every '"$every"' tics\?, player [0-9]* of '"$players"'$/\1/p')"
    idx="$idx $(echo "$line" | sed -n 's/.* player \([0-9]*\) of .*/\1/p')"
    t_check "player $n played ${reached:-?} tics (need $tics or more; ${line:-no TEST line})" test "${reached:-0}" -ge "$tics"
    t_check "player $n logged no desync" bash -c "! grep -q 'OUT OF SYNC' '$log' '$t_tmp/p$n.out'"
    t_check "player $n saw no version mismatch" bash -c "! grep -q 'different versions' '$log' '$t_tmp/p$n.out'"
    if [ "$nosound" = "$n" ]; then
        t_check "player $n ran with sound off" grep -q '^TEST: SoundToggle 0,' "$log"
    elif [ -n "$nosound" ]; then
        t_check "player $n ran with sound on" grep -q '^TEST: SoundToggle 1,' "$log"
    fi
    checks="$(echo "$line" | sed -n 's/.*: \([0-9]*\) sync checks.*/\1/p')"
    need=$((tics - 40)); [ "$every" -eq 8 ] && need=$((tics / 8 - 8))
    t_check "player $n made ${checks:-?} sync checks (need at least $need)" test "${checks:-0}" -ge "$need"
done

idxs="$(echo $idx | tr ' ' '\n' | sort -n | tr '\n' ' ')"
t_check "the players are numbered $(seq -s ' ' 0 $((players - 1))) (got $idxs)" test "$idxs" = "$(seq -s ' ' 0 $((players - 1))) "
t_check "the host is player 0" grep -q 'player 0 of' "$t_tmp/p0/duke3d.log"

size0="$(stat -c %s "$t_tmp/p0/d.bin" 2>/dev/null || echo 0)"
t_check "the host's -testdump has $tics records of 32 bytes ($((size0 / 32)) records, $size0 bytes)" test "$size0" -eq $((tics * 32))
for n in $(seq 1 $((players - 1))); do
    d="$("$root/tests/tools/testdump.py" diff "$t_tmp/p0/d.bin" "$t_tmp/p$n/d.bin" 2>&1)"
    t_check "player $n's -testdump is the same as the host's ($d)" cmp -s "$t_tmp/p0/d.bin" "$t_tmp/p$n/d.bin"
done
if [ "$mode" = relay ] && [ -n "$impair" ]; then
    t_note "(with impairment: the game ran its $tics tics through $impair)"
fi

if [ "$t_fail" -ne 0 ] && [ -n "${JFDUKE3D_TEST_VERBOSE:-}" ]; then
    for n in $(seq 0 $((players - 1))); do echo "---- p$n log"; grep -v "^$" "$t_tmp/p$n/duke3d.log" | tail -n 25; done
fi
t_result
