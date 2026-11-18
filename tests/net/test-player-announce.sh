#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Every machine holds every player's announced settings (bugs.md D1, brief F-D1). In a master/slave
# game the master re-transmits each slave's player announcement (packet 6: name, weapon order,
# aim mode, auto-aim, weapon switch) to the other slaves, and a slave used to file it under the
# master, the machine it came from, not under the player the packet is about. Three or more players
# were affected, two were not.
#
#   tests/net/test-player-announce.sh [--game FILE] [--tics N] [--only relay-3|relay-4|udp-3]
#
# Three games, each with a different configuration for every player (duke3d.cfg in the player's
# work directory: PlayerName, MouseAiming, AutoAim, WeaponSwitchMode, WeaponChoice0 to 9; every
# player's differ from every other's in the weapon order, the name and the weapon-switch mode, and
# in the pair of aim mode and auto-aim as far as two bits go round):
#   relay-3   three players through a local vnet relay
#   relay-4   four players through a local vnet relay
#   udp-3     three players over plain UDP (-net -nm:3), no relay
# In each, passes when: every game exits 0 and logs no desync; and, on every machine, the
# -teststate dump (testhooks.c: a field by field text dump of what -testdump hashes) of the first
# tic, the second and tic 150 says, for every player, that player's own settings: the name, the 10
# weapon choices, auto_aim and weaponswitch, and (first tic only: the game takes the aim mode from the
# players' input from then on) aim_mode; and the -testdump records of every tic are identical on
# every machine (they now hash these fields). Which player a configuration belongs to is read from
# the "player I of P" line of that game's log (the slot a joiner takes is the order its first
# packet reaches the master).
#
# Without the fix (bugs.md D1) a slave holds the master's entry overwritten with another slave's
# and never sets the other slaves' (the names are empty, the weapon orders and settings are
# defaults): the settings checks fail on the slaves and so do the -testdump comparisons.
# About 3 x 25 s.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

game="$root/duke3d"; tics=200; only=""
while [ $# -gt 0 ]; do
    case "$1" in
        --game) game="$2"; shift 2 ;;
        --tics) tics="$2"; shift 2 ;;
        --only) only="$2"; shift 2 ;;     # one scenario: relay-3, relay-4 or udp-3
        *) echo "unknown option $1" >&2; exit 2 ;;
    esac
done
t_need_data

rport=$((port_base + 90))
uport=$((port_base + 95))
limit=$((tics / 20 + 60))

# What each player (launch order 0 to 3) is configured with.
names=(Alpha Bravo Charlie Delta)
aim=(0 1 1 0)             # MouseAiming: the aim mode announced
auto=(1 0 1 0)            # AutoAim
wsw=(2 0 1 3)             # WeaponSwitchMode
wch=("3 4 5 7 8 6 0 2 9 1" "1 2 3 4 5 6 7 8 9 0" "9 8 7 6 5 4 3 2 1 0" "2 4 6 8 0 1 3 5 7 9")

write_cfg() {   # DIR N
    local d="$2" w i
    mkdir -p "$1"
    {
        echo "[Comm Setup]"
        echo "PlayerName = \"${names[$2]}\""
        echo "[Controls]"
        echo "MouseAiming = ${aim[$2]}"
        echo "AutoAim = ${auto[$2]}"
        echo "WeaponSwitchMode = ${wsw[$2]}"
        echo "[Misc]"
        i=0; for w in ${wch[$2]}; do echo "WeaponChoice$i = $w"; i=$((i + 1)); done
    } > "$1/duke3d.cfg"
}

# The check, in Python: SCENARIO-DIR PLAYERS, expectations on the command line as JSON.
# Prints one line per problem; exit 0 when there are none.
check_states() {
    python3 -I - "$@" <<'PY'
import json, sys

d, count, slots_json, cfg_json = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
slots = json.loads(slots_json)          # launch number -> player slot
cfg = json.loads(cfg_json)              # launch number -> its settings
problems = 0
checked = 0

def parse(path):
    """tic -> {player: {field: int}}"""
    out, tic = {}, None
    with open(path) as f:
        for line in f:
            w = line.split()
            if not w:
                continue
            if w[0][0] == "t" and len(w) > 1 and w[1].startswith("randomseed="):
                tic = int(w[0][1:]); out[tic] = {}
            elif w[0] == "player" and tic is not None:
                out[tic][int(w[1])] = {k: int(v) for k, v in (x.split("=") for x in w[2:])}
    return out

for run in range(count):                # run = launch number of the machine
    st = parse("%s/p%d/d.bin.state" % (d, run))
    for tic in (1, 2, 150):
        if tic not in st:
            print("machine %d: no state for tic %d (has %s)" % (run, tic, sorted(st)))
            problems += 1
            continue
        for other in range(count):
            slot = slots[str(other)]
            p = st[tic].get(slot)
            if p is None:
                print("machine %d tic %d: no player %d" % (run, tic, slot)); problems += 1; continue
            c = cfg[str(other)]
            name = ""
            for k in range(32):
                v = p.get("name%d" % k, 0)
                if v == 0:
                    break
                name += chr(v)
            got = {"name": name, "auto_aim": p["auto_aim"], "weaponswitch": p["weaponswitch"],
                   "wchoice": [p["wchoice%d" % k] for k in range(10)]}
            want = {"name": c["name"].upper(), "auto_aim": c["auto"], "weaponswitch": c["wsw"],
                    "wchoice": c["wch"]}
            if tic == 1:
                got["aim_mode"] = p["aim_mode"]; want["aim_mode"] = c["aim"]
            for key in want:
                checked += 1
                if got[key] != want[key]:
                    problems += 1
                    print("machine %d (player %d), tic %d: player %d (launch %d) %s is %s, want %s"
                          % (run, slots[str(run)], tic, slot, other, key, got[key], want[key]))
print("%d values checked" % checked)
sys.exit(1 if problems else 0)
PY
}

scenario() {   # NAME MODE PLAYERS
    local name="$1" mode="$2" players="$3" n pids=() st log line idx slot code
    local d="$t_tmp/$name" slots="" cfgs="" sep=""
    local common="-v1 -l1 -c2 -testsync -testquit$tics -testdumpd.bin -teststate150"
    t_note "$name: $players players, $mode, a different configuration for each"
    for n in $(seq 0 $((players - 1))); do write_cfg "$d/p$n" "$n"; done

    if [ "$mode" = relay ]; then
        t_start_relay "$rport"
        t_game "$name-p0" "$d/p0" --game "$game" --timeout "$limit" -- -net -relay "127.0.0.1:$rport" -host-room "$players" -- $common
        pids+=("$game_pid")
        t_wait_for "$d/p0/duke3d.log" 'room code [A-Z0-9]{6}' 20 || { t_bad "$name: the host never printed a room code"; t_stop_all; return; }
        code="$(grep -o 'room code [A-Z0-9]*' "$d/p0/duke3d.log" | head -1 | awk '{print $3}')"
        for n in $(seq 1 $((players - 1))); do
            t_game "$name-p$n" "$d/p$n" --game "$game" --timeout "$limit" -- -net -relay "127.0.0.1:$rport" -room "$code" -- $common
            pids+=("$game_pid")
        done
    else
        t_game "$name-p0" "$d/p0" --game "$game" --timeout "$limit" -- -net "-nm:$players" "-p$uport" -- $common
        pids+=("$game_pid")
        sleep 1
        for n in $(seq 1 $((players - 1))); do
            t_game "$name-p$n" "$d/p$n" --game "$game" --timeout "$limit" -- -net -nm "-p$((uport + n))" "127.0.0.1:$uport" -- $common
            pids+=("$game_pid")
        done
    fi

    for n in $(seq 0 $((players - 1))); do
        t_wait_pid "${pids[$n]}" $((limit + 10)); st=$t_status
        log="$d/p$n/duke3d.log"
        t_check "$name: player $n exited 0 (got $st)" test "$st" -eq 0
        line="$(grep -h '^TEST: quitting after' "$log" 2>/dev/null | tail -1)"
        slot="$(echo "$line" | sed -n 's/.* player \([0-9]*\) of '"$players"'$/\1/p')"
        t_check "$name: machine $n is player ${slot:-?} of $players, and played $tics tics (${line:-no TEST line})" \
            test -n "$slot" -a "$(echo "$line" | sed -n 's/^TEST: quitting after \([0-9]*\) game tics.*/\1/p')" -ge "$tics"
        t_check "$name: machine $n logged no desync" bash -c "! grep -q 'OUT OF SYNC' '$log' '$t_tmp/$name-p$n.out'"
        t_check "$name: machine $n saw no version mismatch" bash -c "! grep -q 'different versions' '$log' '$t_tmp/$name-p$n.out'"
        slots="$slots$sep\"$n\": ${slot:-0}"
        cfgs="$cfgs$sep\"$n\": {\"name\": \"${names[$n]}\", \"aim\": ${aim[$n]}, \"auto\": ${auto[$n]}, \"wsw\": ${wsw[$n]}, \"wch\": [${wch[$n]// /, }]}"
        sep=", "
    done
    idx="$(for n in $(seq 0 $((players - 1))); do sed -n 's/^TEST: quitting.* player \([0-9]*\) of .*/\1/p' "$d/p$n/duke3d.log"; done | sort -n | tr '\n' ' ')"
    t_check "$name: the players are numbered $(seq -s ' ' 0 $((players - 1))) (got $idx)" test "$idx" = "$(seq -s ' ' 0 $((players - 1))) "

    # json keys are strings: the python reads them as launch numbers
    local out
    out="$(check_states "$d" "$players" "{$slots}" "{$cfgs}" 2>&1)"; st=$?
    t_check "$name: every machine holds every player's name, weapon order, aim mode, auto-aim and weapon switch ($(echo "$out" | tail -1))" test "$st" -eq 0
    [ "$st" -ne 0 ] && echo "$out" | head -n 12 | sed 's/^/        /'

    for n in $(seq 0 $((players - 1))); do
        [ "$(stat -c %s "$d/p$n/d.bin" 2>/dev/null || echo 0)" -eq $((tics * 32)) ] || t_bad "$name: machine $n's -testdump does not have $tics records"
    done
    for n in $(seq 1 $((players - 1))); do
        out="$("$root/tests/tools/testdump.py" diff "$d/p0/d.bin" "$d/p$n/d.bin" 2>&1)"
        t_check "$name: machine $n's -testdump is the same as the host's ($out)" cmp -s "$d/p0/d.bin" "$d/p$n/d.bin"
    done
    t_stop_all; t_stopped=""     # the relay of this scenario goes with it
    t_pids=()
}

[ -z "$only" -o "$only" = relay-3 ] && scenario relay-3 relay 3
[ -z "$only" -o "$only" = relay-4 ] && scenario relay-4 relay 4
[ -z "$only" -o "$only" = udp-3 ] && scenario udp-3 udp 3

t_result
