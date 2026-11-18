#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Shared helpers for the network tests (source this file).
#
#   * ports: every test listens on 127.0.0.1 only, in a range of its own above
#     $JFDUKE3D_TEST_PORT_BASE (default 47400; jfsw-browser's tests default to 47100, so the
#     two games' suites do not collide on ports; run them one at a time anyway, they are
#     timing sensitive);
#   * the vnet relay is built from ext/vnet/relay with Go (once, into
#     ~/.cache/jfduke3d-browser or $JFDUKE3D_CACHE) and run locally;
#   * every process a test starts is recorded and stopped on exit, however the
#     test ends.

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cache="${JFDUKE3D_CACHE:-$HOME/.cache/jfduke3d-browser}"
port_base="${JFDUKE3D_TEST_PORT_BASE:-47400}"
export PATH="$PATH:/usr/local/go/bin"

t_pids=()
t_tmp="$(mktemp -d "${TMPDIR:-/tmp}/jfduke3d-net.XXXXXX")" || exit 125
t_fail=0

t_descendants() {   # PID: PID and everything below it
    local c
    echo "$1"
    for c in $(pgrep -P "$1" 2>/dev/null); do t_descendants "$c"; done
}

t_stopped=""
t_orphans=0
# Stop everything this test started: the processes it recorded and whatever
# they started (the games run under run-headless.sh wrappers; a wrapper that
# is killed outright leaves its duke3d behind). TERM goes to the recorded
# processes only, once, so that the wrappers stop their games themselves;
# what is still alive after 8 s, or alive although its wrapper is gone, is
# killed and counted in t_orphans (t_result fails the test for it).
t_stop_all() {
    [ -n "$t_stopped" ] && return
    t_stopped=1
    local p i alive all=() d
    for p in "${t_pids[@]:-}"; do
        [ -n "$p" ] && all+=($(t_descendants "$p"))
    done
    for p in "${t_pids[@]:-}"; do
        [ -n "$p" ] && kill -TERM "$p" 2>/dev/null
    done
    for i in $(seq 1 80); do
        alive=0
        for p in "${all[@]:-}"; do
            [ -n "$p" ] && kill -0 "$p" 2>/dev/null && alive=1
        done
        [ "$alive" = 0 ] && break
        sleep 0.1
    done
    # anything of ours still alive: it was not stopped by its wrapper
    for p in "${all[@]:-}"; do
        if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then
            echo "orphan: process $p ($(tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | cut -c1-80)) outlived its test" >&2
            t_orphans=$((t_orphans + 1))
            kill -KILL "$p" 2>/dev/null
        fi
    done
    # and anything running in one of our work directories that we never saw
    for d in /proc/[0-9]*; do
        p="${d#/proc/}"
        case "$(readlink "$d/cwd" 2>/dev/null)" in
            "$t_tmp"/*)
                echo "orphan: process $p ($(tr '\0' ' ' < "$d/cmdline" 2>/dev/null | cut -c1-80)) runs in the test directory" >&2
                t_orphans=$((t_orphans + 1)); kill -KILL "$p" 2>/dev/null ;;
        esac
    done
}

t_cleanup() {
    t_stop_all
    if [ -z "${JFDUKE3D_TEST_KEEP:-}" ]; then rm -rf "$t_tmp"; else echo "kept: $t_tmp" >&2; fi
}
trap t_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

t_note() { echo "== $*"; }
t_ok()   { echo "ok:   $*"; }
t_bad()  { echo "FAIL: $*"; t_fail=$((t_fail + 1)); }

# t_check DESCRIPTION CONDITION-EXIT-STATUS: usage  t_check "text" test -f file
t_check() {
    local what="$1"; shift
    if "$@"; then t_ok "$what"; else t_bad "$what"; fi
}

# Build the relay once per vnet revision.
t_build_relay() {
    local rev bin
    rev="$(git -C "$root/ext/vnet" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    bin="$cache/vnet-relay-$rev"
    if [ ! -x "$bin" ]; then
        command -v go >/dev/null || { echo "go not found (need Go 1.24 or newer for ext/vnet/relay)" >&2; exit 125; }
        mkdir -p "$cache"
        ( cd "$root/ext/vnet/relay" && go build -o "$bin.tmp" ./cmd/vnet-relay ) >&2 || { echo "relay build failed" >&2; exit 125; }
        mv "$bin.tmp" "$bin"
    fi
    relay_bin="$bin"
}

# t_start_relay PORT [relay flags...]: sets relay_pid, log in $t_tmp/relay-PORT.log
t_start_relay() {
    local port="$1"; shift
    [ -n "${relay_bin:-}" ] || t_build_relay
    "$relay_bin" -udp "127.0.0.1:$port" -http "" -v "$@" > "$t_tmp/relay-$port.log" 2>&1 &
    relay_pid=$!
    t_pids+=("$relay_pid")
    local i
    for i in $(seq 1 50); do
        grep -q '^LISTEN' "$t_tmp/relay-$port.log" 2>/dev/null && return 0
        kill -0 "$relay_pid" 2>/dev/null || break
        sleep 0.1
    done
    echo "relay did not start on 127.0.0.1:$port:" >&2; cat "$t_tmp/relay-$port.log" >&2
    exit 125
}

# t_wait_for FILE REGEX SECONDS: 0 when REGEX appears in FILE
t_wait_for() {
    local f="$1" re="$2" secs="$3" i
    for i in $(seq 1 $((secs * 10))); do
        grep -Eq -- "$re" "$f" 2>/dev/null && return 0
        sleep 0.1
    done
    return 1
}

# t_wait_pid PID SECONDS: wait for a child of this shell to end. Prints its
# status in t_status, or 999 if it did not end in time (it is then killed).
t_wait_pid() {
    local pid="$1" secs="$2" i
    for i in $(seq 1 $((secs * 10))); do
        if ! kill -0 "$pid" 2>/dev/null; then
            wait "$pid" 2>/dev/null; t_status=$?
            return 0
        fi
        sleep 0.1
    done
    kill -TERM "$pid" 2>/dev/null; sleep 0.5; kill -KILL "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null
    t_status=999
    return 1
}

# The shareware GRP is the test data, and shareware network games are refused unless
# allowed (D14): t_game puts -allowsharewarenet in front of the game's arguments
# (it must come before -net: what follows -net up to "--" is mmulti's). The gate's
# own test, and a game built before the gate existed, set T_ALLOW to "none".
t_allow="-allowsharewarenet"

# t_game NAME WORKDIR [run-headless options -- ] game args...:
# start a headless game in the background; sets game_pid; its stdout and
# stderr go to $t_tmp/NAME.out and its log is WORKDIR/duke3d.log.
t_game() {
    local name="$1" wd="$2"; shift 2
    local opts=() allow=()
    while [ $# -gt 0 ] && [ "$1" != "--" ]; do opts+=("$1"); shift; done
    [ "${1:-}" = "--" ] && shift
    [ "${T_ALLOW:-}" = none ] || allow=("$t_allow")
    "$root/scripts/run-headless.sh" --workdir "$wd" "${opts[@]}" "${allow[@]}" "$@" > "$t_tmp/$name.out" 2>&1 &
    game_pid=$!
    t_pids+=("$game_pid")
}

t_need_data() {
    [ -f "$root/testdata/duke3dshare.grp" ] || { echo "testdata/duke3dshare.grp is missing: run scripts/fetch-test-data.sh" >&2; exit 125; }
    [ -x "${game:-$root/duke3d}" ] || { echo "${game:-$root/duke3d} is missing: run make" >&2; exit 125; }
}

t_result() {
    t_stop_all
    t_check "no process this test started is left running" test "$t_orphans" -eq 0
    if [ "$t_fail" -eq 0 ]; then echo "PASS"; exit 0; fi
    echo "FAILED: $t_fail check(s)"; exit 1
}
