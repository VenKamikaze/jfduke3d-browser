#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Brief 05 (jfSW's review B1, and Duke's own cases): the relay gives a departed
# member's address (10.0.0.N) to the next joiner. A newcomer at the address of
# a player who is in the running game must be refused ("the game has already
# started"), not taken for that player: mmulti tells sessions apart by a random
# session id in the start-up exchange, not by the address. Headless games
# through a local relay whose session timeout is 3 s (so that a vanished
# player's address is free again soon), co-op:
#
#   vanish  the guest's process is killed mid-game (no goodbye); 4.5 s later a
#           newcomer joins with the same room code and gets the guest's
#           address. The newcomer is refused at once; the host ends its game
#           with "player 2 (...) left the game" about 15 s after the guest's
#           last packet (the newcomer's pings do not count as the guest's).
#   quit3   (Duke: a guest that quits properly is taken out of the game and the
#           others play on) a game of 3: guest 2 quits at tic 200 (the console's
#           quit); 3 s later a newcomer joins and gets its address. The newcomer
#           is refused at once; the host and guest 3 play on to tic 1200 and
#           exit 0.
#   quit2   a game of 2: the guest quits at tic 200 and the host plays on
#           alone. mmulti's getpacket() does nothing while numplayers is 1, so
#           the host neither answers a newcomer nor keeps its relay session
#           alive (bugs.md D22): the newcomer is never let in and ends with
#           "the host did not answer" (15 s) or, when the relay has timed the
#           host's session out already (3 s here), "there is no room with that
#           code" (at once). The host plays on to tic 1200 and exits 0.
#
# (The quitting guests run -testnodraw: a game that quits on shareware data shows two order screens that wait for
# a key, and a hidden tab leaves them at once: userack(), brief 05.)
#
#   tests/net/test-rejoin.sh [--game FILE]
#
# About 2 minutes.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

game="$root/duke3d"
while [ $# -gt 0 ]; do
    case "$1" in
        --game|--sw) game="$2"; shift 2 ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
    esac
done
t_need_data

rport=$((port_base + 90))
auto="-v1 -l1 -c2 -testsync"
t_start_relay "$rport" -session-timeout 3s -keepalive 1s

game_proc() { pgrep -P "$1" -x duke3d | head -1; }   # the game under a run-headless wrapper

# newcomer NAME CODE EXPECTED-REGEX MAXSECONDS: a joiner that must not get in; checks its message, time and address
alone_re="the host did not answer|there is no room with that code"
newcomer() {
    local name="$1" code="$2" re="$3" max="$4" t0 took
    t0=$(date +%s.%N)
    t_game "$name" "$t_tmp/$name" --game "$game" --timeout 60 -- -net -relay "127.0.0.1:$rport" -room "$code" -- $auto -testdumpd.bin
    t_wait_pid "$game_pid" $((max + 10)); local st=$t_status
    took=$(echo "$(date +%s.%N) - $t0" | bc)
    [ "$re" = "$alone_re" ] || t_check "$name: got the departed guest's address, so the case is the one under test" grep -Eq "joined room $code as 10\.0\.0\.[23] " "$t_tmp/$name.out"
    t_check "$name: refused, exit 1 (got $st) after ${took}s (under ${max}s)" bash -c "[ $st -eq 1 ] && [ \$(echo '$took < $max' | bc) -eq 1 ]"
    t_check "$name: told /$re/" grep -Eq "Network game failed: $re" "$t_tmp/$name.out"
    t_check "$name: never started a game" bash -c "! grep -q 'Lobby: the game starts' '$t_tmp/$name.out' && [ ! -s '$t_tmp/$name/d.bin' ]"
}

t_note "vanish: the guest's process dies mid-game, a newcomer gets its address (load $(cut -d' ' -f1-3 /proc/loadavg))"
t_game h1 "$t_tmp/h1" --game "$game" --timeout 120 -- -net -relay "127.0.0.1:$rport" -host-room 2 -- $auto -testquit4000 -testdumpd.bin
hp=$game_pid
t_wait_for "$t_tmp/h1.out" 'room code [A-Z0-9]{6}' 20 || t_bad "no room code"
code="$(grep -o 'room code [A-Z0-9]*' "$t_tmp/h1.out" | head -1 | awk '{print $3}')"
t_game g1 "$t_tmp/g1" --game "$game" --timeout 120 -- -net -relay "127.0.0.1:$rport" -room "$code" -- $auto -testquit4000 -testdumpd.bin
gp=$game_pid
t_wait_for "$t_tmp/g1.out" 'Lobby: the game starts' 30 || t_bad "the game did not start"
for i in $(seq 1 100); do [ "$(stat -c %s "$t_tmp/h1/d.bin" 2>/dev/null || echo 0)" -ge $((200 * 32)) ] && break; sleep 0.2; done
kill -KILL "$(game_proc "$gp")" 2>/dev/null
tkill=$(date +%s.%N)
sleep 4.5
newcomer n1 "$code" "the game has already started" 10
t_wait_pid "$hp" 40; hs=$t_status
took=$(echo "$(date +%s.%N) - $tkill" | bc)
t_check "vanish: the host ended with status 1 (got $hs), ${took}s after the guest died (14 to 30 s)" bash -c "[ $hs -eq 1 ] && [ \$(echo '$took >= 14 && $took <= 30' | bc) -eq 1 ]"
t_check "vanish: the host says player 2 left the game" grep -q "Network game failed: player 2 (.*) left the game" "$t_tmp/h1.out"

t_note "quit3: a game of 3, guest 2 quits properly at tic 200, a newcomer gets its address"
t_game h2 "$t_tmp/h2" --game "$game" --timeout 150 -- -net -relay "127.0.0.1:$rport" -host-room 3 -- $auto -testquit1200 -testdumpd.bin
hp=$game_pid
t_wait_for "$t_tmp/h2.out" 'room code [A-Z0-9]{6}' 20 || t_bad "no room code"
code="$(grep -o 'room code [A-Z0-9]*' "$t_tmp/h2.out" | head -1 | awk '{print $3}')"
t_game g2 "$t_tmp/g2" --game "$game" --timeout 150 -- -net -relay "127.0.0.1:$rport" -room "$code" -- $auto -testquit1200 -testdumpd.bin -testosd200,quit -testnodraw
gp=$game_pid
t_wait_for "$t_tmp/h2.out" 'Lobby: 2 of 3 players are in' 30 || t_bad "guest 2 did not arrive"
t_game g3 "$t_tmp/g3" --game "$game" --timeout 150 -- -net -relay "127.0.0.1:$rport" -room "$code" -- $auto -testquit1200 -testdumpd.bin
g3p=$game_pid
t_wait_for "$t_tmp/h2.out" 'Lobby: the game starts with 3 players' 30 || t_bad "the game of 3 did not start"
t_wait_for "$t_tmp/g2/duke3d.log" 'console command at tic 200: quit' 60 || t_bad "guest 2 did not quit"
t_wait_pid "$gp" 20
sleep 3
newcomer n2 "$code" "the game has already started" 10
t_wait_pid "$hp" 90; hs=$t_status
t_wait_pid "$g3p" 30; g3s=$t_status
t_check "quit3: the host played on with guest 3 and exited 0 (got $hs)" test "$hs" = 0
t_check "quit3: guest 3 exited 0 (got $g3s)" test "$g3s" = 0
t_check "quit3: the host reached tic 1200" grep -Eq "TEST: quitting after 1[0-9]{3} game tics" "$t_tmp/h2.out"
t_check "quit3: the others saw the player leave" grep -q "is history" "$t_tmp/h2.out"
t_check "quit3: the host and guest 3 agree on every tic they both played" bash -c "cmp -n \$((1200*32)) '$t_tmp/h2/d.bin' '$t_tmp/g3/d.bin'"

t_note "quit2: a game of 2, the guest quits at tic 200, the host is alone and a newcomer gets no answer (bugs.md D22)"
t_game h3 "$t_tmp/h3" --game "$game" --timeout 150 -- -net -relay "127.0.0.1:$rport" -host-room 2 -- $auto -testquit1200 -testdumpd.bin
hp=$game_pid
t_wait_for "$t_tmp/h3.out" 'room code [A-Z0-9]{6}' 20 || t_bad "no room code"
code="$(grep -o 'room code [A-Z0-9]*' "$t_tmp/h3.out" | head -1 | awk '{print $3}')"
t_game g4 "$t_tmp/g4" --game "$game" --timeout 150 -- -net -relay "127.0.0.1:$rport" -room "$code" -- $auto -testquit1200 -testdumpd.bin -testosd200,quit -testnodraw
gp=$game_pid
t_wait_for "$t_tmp/g4/duke3d.log" 'console command at tic 200: quit' 60 || t_bad "the guest did not quit"
t_wait_pid "$gp" 20
sleep 3
newcomer n3 "$code" "$alone_re" 25
t_wait_pid "$hp" 90; hs=$t_status
t_check "quit2: the host played on alone and exited 0 (got $hs)" test "$hs" = 0
t_check "quit2: the host reached tic 1200" grep -Eq "TEST: quitting after 1[0-9]{3} game tics" "$t_tmp/h3.out"
t_result
