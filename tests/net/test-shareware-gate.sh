#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# D14, the shareware network gate: with the shareware GRP, network games are refused unless
# allowed, by plain UDP (-net) and through a relay alike; registered data always allows them.
#
#   tests/net/test-shareware-gate.sh [--game FILE]
#
# Every case starts a game with T_ALLOW=none (tests/net/lib.sh adds no -allowsharewarenet):
#  refused    shareware GRP, no option: plain UDP host, relay host and relay joiner each exit 1 at once
#             with "Network game refused" and the licence reason, never waiting for players; the
#             relay made no room (the refusal comes before anything is opened); with
#             "AllowSharewareNetGames = 0" in duke3d.cfg the same;
#  single     the same GRP, no -net: single player is not affected (quits by itself, exit 0);
#  cli        -allowsharewarenet: the relay host and the plain UDP host wait for players
#             (printing the room code / "Waiting for players..."), and two players play 100 tics
#             over UDP together;
#  cfg        "AllowSharewareNetGames = 1" under [Comm Setup] in duke3d.cfg: the same, with no argument;
#  console    (brief 05) the console's host and join ask the gate too: a single player game on shareware data with no
#             option and a relay in duke3d.cfg types "host 2" (-testosd) and "join ABC234": the console says the licence reason, nothing
#             is re-launched and the game plays on to its end; with -allowsharewarenet "host 2" re-launches the game;
#  registered a copy of the GRP, named duke3d.grp (the default name, since the game cannot identify it), that grpscan.c does not know and that has no DUKESW.BIN (made by
#             modgrp.py: the game takes it for registered data): network games start with no option.
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
export T_ALLOW=none

rport=$((port_base + 90))
uport=$((port_base + 94))
t_start_relay "$rport"

# refused NAME FAIL-REGEX args...: exit 1 at once with the message, never waiting
refused() {
    local name="$1" wd="$t_tmp/$1" opts=(); shift
    local t0 t1 st took
    while [ $# -gt 0 ] && [ "$1" != "--" ]; do opts+=("$1"); shift; done
    shift
    case "$name" in g-*) wd="$t_tmp/gsub" ;; both-*) wd="$t_tmp/both" ;; esac
    t0=$(date +%s.%N)
    t_game "$name" "$wd" --game "$game" --timeout 40 "${opts[@]}" -- "$@"
    t_wait_pid "$game_pid" 45; st=$t_status
    t1=$(date +%s.%N); took=$(echo "$t1 - $t0" | bc)
    t_check "$name: refused, exit status 1 (got $st) after ${took}s (at most 20 s)" bash -c "[ $st -eq 1 ] && [ \$(echo '$took <= 20' | bc) -eq 1 ]"
    t_check "$name: says why: 'Network game refused' and the licence" bash -c "grep -q 'Network game refused' '$t_tmp/$name.out' && grep -q 'does not allow online multiplayer' '$t_tmp/$name.out' && grep -q 'Network game refused' '$wd/duke3d.log'"
    t_check "$name: never waited for players" bash -c "! grep -q 'Waiting for players' '$wd/duke3d.log'"
}

t_note "refused by default (shareware GRP, no option)"
refused udp-host -- -net -nm:2 "-p$uport" -- -v1 -l1 -c2
refused udp-join -- -net -nm "-p$((uport + 1))" "127.0.0.1:$uport" -- -v1 -l1 -c2
refused relay-host -- -net -relay "127.0.0.1:$rport" -host-room 2 -- -v1 -l1 -c2
refused relay-join -- -net -relay "127.0.0.1:$rport" -room ABCDE2 -- -v1 -l1 -c2
t_check "the relay made no room for the refused host" bash -c "! grep -q 'created' '$t_tmp/relay-$rport.log'"
mkdir -p "$t_tmp/cfg0"; printf '[Comm Setup]\nAllowSharewareNetGames = 0\n' > "$t_tmp/cfg0/duke3d.cfg"
t_game cfg-zero "$t_tmp/cfg0" --game "$game" --timeout 40 -- -net -nm:2 "-p$uport" -- -v1 -l1 -c2
t_wait_pid "$game_pid" 45
t_check "an explicit AllowSharewareNetGames = 0 refuses too (exit $t_status)" bash -c "[ $t_status -eq 1 ] && grep -q 'Network game refused' '$t_tmp/cfg0/duke3d.log'"

t_note "shareware data that is not the main GRP: -g from a subfolder, the main GRP missing (the gate must see the data that is mounted)"
mkdir -p "$t_tmp/gsub/sub"; ln -sf "$root/testdata/duke3dshare.grp" "$t_tmp/gsub/sub/duke3dshare.grp"
refused g-udp-host --grp none -- -net -nm:2 "-p$uport" -- -v1 -l1 -c2 -gsub/duke3dshare.grp
refused g-relay-host --grp none -- -net -relay "127.0.0.1:$rport" -host-room 2 -- -v1 -l1 -c2 -gsub/duke3dshare.grp
refused g-relay-join --grp none -- -net -relay "127.0.0.1:$rport" -room ABCDE2 -- -v1 -l1 -c2 -gsub/duke3dshare.grp
t_check "the relay made no room for them either" bash -c "! grep -q 'created' '$t_tmp/relay-$rport.log'"

t_note "both a registered-looking GRP and the shareware GRP present: the game loads the shareware one, so it is refused"
mkdir -p "$t_tmp/both"; ln -sf "$root/testdata/duke3dshare.grp" "$t_tmp/both/duke3dshare.grp"
"$root/tests/net/modgrp.py" registered "$root/testdata/duke3dshare.grp" "$t_tmp/both/duke3d.grp" >/dev/null || t_bad "modgrp.py failed"
refused both-udp --grp none -- -net -nm:2 "-p$uport" -- -v1 -l1 -c2

t_note "the console's host and join ask the gate (brief 05)"
mkdir -p "$t_tmp/con"; printf '[Comm Setup]\nRelay = "127.0.0.1:%s"\n' "$rport" > "$t_tmp/con/duke3d.cfg"
t_game con-host "$t_tmp/con" --game "$game" --timeout 60 -- -v1 -l1 -testosd40,host\ 2 -testquit120
t_wait_pid "$game_pid" 70
t_check "console host: refused with the licence reason, no re-launch, the game played on (exit $t_status)" bash -c "[ $t_status -eq 0 ] && grep -q 'console command at tic 40: host 2' '$t_tmp/con/duke3d.log' && grep -q 'Network games are switched off for the shareware version' '$t_tmp/con/duke3d.log' && ! grep -q 'Re-launching' '$t_tmp/con-host.out' && grep -q '^TEST: quitting after 120 game tics' '$t_tmp/con/duke3d.log'"
t_game con-join "$t_tmp/con" --game "$game" --timeout 60 -- -v1 -l1 -testosd40,join\ abc234 -testquit120
t_wait_pid "$game_pid" 70
t_check "console join: refused the same way (exit $t_status)" bash -c "[ $t_status -eq 0 ] && grep -q 'Network games are switched off for the shareware version' '$t_tmp/con/duke3d.log' && ! grep -q 'Re-launching' '$t_tmp/con-join.out'"

t_note "single player is not affected"
t_game single "$t_tmp/single" --game "$game" --timeout 60 -- -v1 -l1 -testquit60
t_wait_pid "$game_pid" 70
t_check "single player on shareware: played 60 tics and quit (exit $t_status)" bash -c "[ $t_status -eq 0 ] && grep -q '^TEST: quitting after 60 game tics' '$t_tmp/single/duke3d.log'"

# allowed NAME WORKDIR-SETUP args: started, waits for players
allowed() {
    local name="$1" re="$2"; shift 2
    t_game "$name" "$t_tmp/$name" --game "$game" --timeout 30 -- "$@"
    local pid=$game_pid
    t_check "$name: allowed: reached the wait for players ($(grep -h -m1 -E "$re" "$t_tmp/$name/duke3d.log" 2>/dev/null))" t_wait_for "$t_tmp/$name/duke3d.log" "$re" 20
    t_check "$name: not refused" bash -c "! grep -q 'Network game refused' '$t_tmp/$name.out'"
    kill -TERM "$pid" 2>/dev/null; t_wait_pid "$pid" 15
}

t_note "allowed with -allowsharewarenet (before -net)"
T_ALLOW= allowed cli-relay 'room code [A-Z0-9]{6}' -allowsharewarenet -net -relay "127.0.0.1:$rport" -host-room 2 -- -v1 -l1 -c2
T_ALLOW= allowed cli-udp 'Waiting for players' -allowsharewarenet -net -nm:2 "-p$uport" -- -v1 -l1 -c2

t_note "allowed with the option when the shareware data comes in by -g"
T_ALLOW= t_game g-allowed "$t_tmp/gsub" --game "$game" --grp none --timeout 30 -- -allowsharewarenet -net -relay "127.0.0.1:$rport" -host-room 2 -- -v1 -l1 -c2 -gsub/duke3dshare.grp
pid=$game_pid
t_check "g-allowed: -allowsharewarenet lets it through" t_wait_for "$t_tmp/gsub/duke3d.log" 'room code [A-Z0-9]{6}' 20
kill -TERM "$pid" 2>/dev/null; t_wait_pid "$pid" 15

t_note "allowed by the configuration file"
mkdir -p "$t_tmp/cfg1"; printf '[Comm Setup]\nAllowSharewareNetGames = 1\n' > "$t_tmp/cfg1/duke3d.cfg"
t_game cfg-relay "$t_tmp/cfg1" --game "$game" --timeout 30 -- -net -relay "127.0.0.1:$rport" -host-room 2 -- -v1 -l1 -c2
pid=$game_pid
t_check "cfg-relay: allowed by AllowSharewareNetGames = 1: room code printed" t_wait_for "$t_tmp/cfg1/duke3d.log" 'room code [A-Z0-9]{6}' 20
kill -TERM "$pid" 2>/dev/null; t_wait_pid "$pid" 15
code="$(grep -o 'room code [A-Z0-9]*' "$t_tmp/cfg1/duke3d.log" | head -1 | awk '{print $3}')"

t_note "two players over UDP, allowed by the configuration file and by the argument, play 100 tics"
mkdir -p "$t_tmp/cfg2"; printf '[Comm Setup]\nAllowSharewareNetGames = 1\n' > "$t_tmp/cfg2/duke3d.cfg"
t_game g0 "$t_tmp/cfg2" --game "$game" --timeout 60 -- -net -nm:2 "-p$((uport + 2))" -- -v1 -l1 -c2 -testquit100
p0=$game_pid; sleep 1
T_ALLOW= t_game g1 "$t_tmp/g1" --game "$game" --timeout 60 -- -allowsharewarenet -net -nm "-p$((uport + 3))" "127.0.0.1:$((uport + 2))" -- -v1 -l1 -c2 -testquit100
p1=$game_pid
t_wait_pid "$p0" 70; s0=$t_status; t_wait_pid "$p1" 70; s1=$t_status
t_check "both games ran 100 tics and quit (exit $s0 and $s1)" bash -c "[ $s0 -eq 0 ] && [ $s1 -eq 0 ] && grep -q 'TEST: quitting after 100' '$t_tmp/cfg2/duke3d.log' && grep -q 'TEST: quitting after 100' '$t_tmp/g1/duke3d.log'"

t_note "registered data (a GRP the game does not know, with no DUKESW.BIN): allowed with no option"
mkdir -p "$t_tmp/regdata"
crc="$("$root/tests/net/modgrp.py" registered "$root/testdata/duke3dshare.grp" "$t_tmp/regdata/duke3d.grp")" || t_bad "modgrp.py failed"
t_game reg "$t_tmp/reg" --game "$game" --grp "$t_tmp/regdata/duke3d.grp" --timeout 30 -- -net -relay "127.0.0.1:$rport" -host-room 2 -- -v1 -l1 -c2
pid=$game_pid
t_check "registered ($crc): the relay host got its room code with no option" t_wait_for "$t_tmp/reg/duke3d.log" 'room code [A-Z0-9]{6}' 20
t_check "registered: not refused" bash -c "! grep -q 'Network game refused' '$t_tmp/reg.out'"
kill -TERM "$pid" 2>/dev/null; t_wait_pid "$pid" 15
t_check "registered: the game did not take the data for shareware" bash -c "! grep -q 'Unregistered Shareware' '$t_tmp/reg/duke3d.log'"

t_result
