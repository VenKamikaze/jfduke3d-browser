#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# -testquit and -testdump outside network games: single player, and demo playback (which a later
# brief uses to compare the native build with the wasm build tic by tic).
#
#   tests/net/test-single.sh [--game FILE] [--tics N]
#
# 1. Two single player games (E1L1) each quit after N tics (-testquit: exit 0 by themselves, not
#    stopped by the time limit) and write a -testdump of N records; the two dumps are identical (the
#    simulation is the same every run: random seed, level and idle player).
# 2. A third game records a demo (-r) in the same way. Then two games each play that demo
#    (-ddemo1: after the logo, which takes about 15 s) and quit after N tics, and their dumps are
#    identical, with N records. (The recording game's own dump is not compared: a game that records
#    spawns the camera effectors visible, one that plays a demo back does not: bugs.md D2.)
# A run with -testnudge on one of the two single player games must make check 1 fail (the proof that
# the dump comparison bites; the nudge is a test of this test).  About 60 s.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

game="$root/duke3d"; tics=300; nudge=""
while [ $# -gt 0 ]; do
    case "$1" in
        --game) game="$2"; shift 2 ;;
        --tics) tics="$2"; shift 2 ;;
        --nudge) nudge="$2"; shift 2 ;;    # test-only: -testnudge<T> on the second single player game
        *) echo "unknown option $1" >&2; exit 2 ;;
    esac
done
t_need_data
limit=$((tics / 10 + 60))

wait_for() {   # NAME PID: exit 0, 300 records
    local name="$1" pid="$2" st size
    t_wait_pid "$pid" $((limit + 10)); st=$t_status
    t_check "$name: exited 0 by itself (got $st; 124 would be the time limit)" test "$st" -eq 0
    t_check "$name: TEST line: quit after $tics tics, player 0 of 1" grep -q "^TEST: quitting after $tics game tics: .* player 0 of 1\$" "$t_tmp/$name/duke3d.log"
    size="$(stat -c %s "$t_tmp/$name/d.bin" 2>/dev/null || echo 0)"
    t_check "$name: the dump has $tics records ($((size / 32)))" test "$size" -eq $((tics * 32))
}

t_note "1. single player twice, $tics tics"
t_game s1 "$t_tmp/s1" --game "$game" --timeout "$limit" -- -v1 -l1 -testquit$tics -testdumpd.bin
p1=$game_pid
t_game s2 "$t_tmp/s2" --game "$game" --timeout "$limit" -- -v1 -l1 -testquit$tics -testdumpd.bin ${nudge:+-testnudge$nudge}
p2=$game_pid
t_game rec "$t_tmp/rec" --game "$game" --timeout "$limit" -- -v1 -l1 -r -testquit$tics -testdumpd.bin
p3=$game_pid
wait_for s1 "$p1"; wait_for s2 "$p2"; wait_for rec "$p3"
d="$("$root/tests/tools/testdump.py" diff "$t_tmp/s1/d.bin" "$t_tmp/s2/d.bin" 2>&1)"
t_check "the two single player dumps are the same ($d)" cmp -s "$t_tmp/s1/d.bin" "$t_tmp/s2/d.bin"

t_note "2. a demo, played back twice"
t_check "the recording game wrote demo1.dmo ($(stat -c %s "$t_tmp/rec/demo1.dmo" 2>/dev/null || echo 0) bytes)" test -s "$t_tmp/rec/demo1.dmo"
for n in 1 2; do
    mkdir -p "$t_tmp/play$n"; cp "$t_tmp/rec/demo1.dmo" "$t_tmp/play$n/" 2>/dev/null
    t_game "play$n" "$t_tmp/play$n" --game "$game" --timeout $((limit + 40)) -- -ddemo1 -testquit$tics -testdumpd.bin
    eval "pp$n=$game_pid"
done
wait_for play1 "$pp1"; wait_for play2 "$pp2"
d="$("$root/tests/tools/testdump.py" diff "$t_tmp/play1/d.bin" "$t_tmp/play2/d.bin" 2>&1)"
t_check "the two demo playback dumps are the same ($d)" cmp -s "$t_tmp/play1/d.bin" "$t_tmp/play2/d.bin"
t_check "a demo was played back (Demo ... not refused; the dump differs from a game's: it is a different level start)" bash -c "! grep -q 'is for\|is corrupt' '$t_tmp/play1/duke3d.log'"

t_result
