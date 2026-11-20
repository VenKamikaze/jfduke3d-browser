#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Brief 05 (L18, the rest): a host or a guest that is gone in the middle of a relay game gives the others a
# message and an orderly end instead of a hang. NetGoneCheck() (src/netlobby.c, from getpackets()) ends
# the game with exit status 1 when the host (seen by a guest) or a guest (seen by the host) has been silent
# for 15 s (mmulti_vnet_silentms()); the host first tells the other guests who left. Headless co-op games
# through a local relay, 400 tics are far from the end of a 4000 tic game, so the game would otherwise wait
# for ever:
#
#   host-gone     2 players; the host's process is killed (no goodbye) at tic 200: the guest ends with
#                 "Network game failed: the host left the game (its machine stopped answering N s ago)"
#   guest-gone    3 players; guest 3 is killed: the host ends with "player 3 (...) left the game (their
#                 machine stopped answering N s ago)" and guest 2, told by the host, with "player 3 left the game"
#   host-quit     2 players; the host quits properly (the console's quit, -testosd200,quit): the guest's game ends
#                 with exit status 0 and the message "The host ended the game" (Duke's own path, domovethings();
#                 plain UDP keeps the original text, bugs.md D21). Both run -testnodraw: a game that ends on
#                 shareware data shows two order screens that wait for a key, which a hidden tab skips (userack())
#   guest-quit    3 players; guest 2 quits properly: the others play on (Duke removes the player, "is history") to tic 600
#
#   tests/net/test-gone.sh [--game FILE] [--only NAME]
#
# About 2 minutes.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

game="$root/duke3d"; only="."
while [ $# -gt 0 ]; do
    case "$1" in
        --game|--sw) game="$2"; shift 2 ;;
        --only) only="$2"; shift 2 ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
    esac
done
t_need_data

rport=$((port_base + 130))
common="-v1 -l1 -c2 -testsync -testdumpd.bin"
t_start_relay "$rport"
want() { echo "$1" | grep -Eq -- "$only"; }
game_proc() { pgrep -P "$1" -x duke3d | head -1; }

# start PLAYERS EXTRA-ARGS-PER-PLAYER...: a game of PLAYERS (p0 hosts); pids in $pids, run dir $d
start() {
    local name="$1" players="$2" quit="$3"; shift 3
    local extra=("$@")      # extra game arguments of player 0, 1, ... (no spaces inside one)
    d="$t_tmp/$name"; pids=()
    t_game p0 "$d/p0" --game "$game" --timeout 150 -- -net -relay "127.0.0.1:$rport" -host-room "$players" -- $common -testquit$quit ${extra[0]:-}
    pids+=("$game_pid")
    t_wait_for "$d/p0/duke3d.log" 'room code [A-Z0-9]{6}' 20 || { t_bad "$name: no room code"; return 1; }
    code="$(grep -o 'room code [A-Z0-9]*' "$d/p0/duke3d.log" | head -1 | awk '{print $3}')"
    local n
    for n in $(seq 1 $((players - 1))); do
        t_game "p$n" "$d/p$n" --game "$game" --timeout 150 -- -net -relay "127.0.0.1:$rport" -room "$code" -- $common -testquit$quit ${extra[$n]:-}
        pids+=("$game_pid")
        t_wait_for "$d/p0/duke3d.log" "mmulti: Player $n is here" 20 || { t_bad "$name: player $n did not join"; return 1; }
    done
    t_wait_for "$d/p0/duke3d.log" "Lobby: the game starts with $players players" 30 || { t_bad "$name: the game did not start"; return 1; }
    return 0
}
wait_tic() {    # RUNDIR TIC
    local i; for i in $(seq 1 300); do [ "$(stat -c %s "$1/d.bin" 2>/dev/null || echo 0)" -ge $(($2 * 32)) ] && return 0; sleep 0.2; done; return 1
}
# ends NAME INDEX REGEX MAXSEC: player INDEX's game ends with exit 1 and REGEX in its output within MAXSEC of $tgone
ends() {
    local name="$1" n="$2" re="$3" max="$4" took
    t_wait_pid "${pids[$n]}" $((max + 20)); local st=$t_status
    took=$(echo "$(date +%s.%N) - $tgone" | bc)
    t_check "$name: player $n ended with status 1 (got $st), ${took}s after the other went (14 to ${max}s)" bash -c "[ $st -eq 1 ] && [ \$(echo '$took >= 14 && $took <= $max' | bc) -eq 1 ]"
    t_check "$name: player $n says /$re/: $(grep -h -m1 -E "Network game failed" "$d/p$n/duke3d.log" | head -1)" grep -Eq "Network game failed: $re" "$d/p$n/duke3d.log"
}

if want host-gone; then
    t_note "host-gone: the host's process dies at tic 200 (load $(cut -d' ' -f1-3 /proc/loadavg))"
    if start host-gone 2 4000 "" ""; then
        wait_tic "$d/p1" 200 || t_bad "host-gone: the game did not reach tic 200"
        kill -KILL "$(game_proc "${pids[0]}")" 2>/dev/null; tgone=$(date +%s.%N)
        ends host-gone 1 "the host left the game \(its machine stopped answering [0-9]+ s ago\)" 30
    fi
fi

if want guest-gone; then
    t_note "guest-gone: guest 3 of 3 dies at tic 200"
    if start guest-gone 3 4000 "" "" ""; then
        wait_tic "$d/p0" 200 || t_bad "guest-gone: the game did not reach tic 200"
        kill -KILL "$(game_proc "${pids[2]}")" 2>/dev/null; tgone=$(date +%s.%N)
        ends guest-gone 0 "player 3 \(.*\) left the game \(their machine stopped answering [0-9]+ s ago\)" 30
        ends guest-gone 1 "player 3 left the game" 35
    fi
fi

if want host-quit; then
    t_note "host-quit: the host quits properly at tic 200"
    if start host-quit 2 4000 "-testosd200,quit -testnodraw" "-testnodraw"; then
        t_wait_pid "${pids[1]}" 60; st=$t_status
        t_check "host-quit: the guest's game ended with status 0 (got $st)" test "$st" -eq 0
        t_check "host-quit: the guest was told the host ended the game" grep -q "The host ended the game" "$t_tmp/p1.out"
        t_wait_pid "${pids[0]}" 30
    fi
fi

if want guest-quit; then
    t_note "guest-quit: guest 2 of 3 quits properly at tic 200, the others play on to tic 600"
    if start guest-quit 3 600 "" "-testosd200,quit -testnodraw" ""; then
        for n in 0 2; do
            t_wait_pid "${pids[$n]}" 90; st=$t_status
            t_check "guest-quit: player $n exited 0 (got $st)" test "$st" -eq 0
            t_check "guest-quit: player $n reached tic 600" grep -Eq "TEST: quitting after 600 game tics" "$d/p$n/duke3d.log"
        done
        t_wait_pid "${pids[1]}" 30
        t_check "guest-quit: the host and guest 3 agree on every tic" cmp -s "$d/p0/d.bin" "$d/p2/d.bin"
        t_check "guest-quit: the host saw the player leave" grep -q "is history" "$d/p0/duke3d.log"
    fi
fi
t_result
