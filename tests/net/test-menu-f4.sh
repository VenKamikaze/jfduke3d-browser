#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# F4 in a game opens the sound menu and Escape gets the player back, in the native game (brief F-D3, bugs.md D3).
#
#   tests/net/test-menu-f4.sh [--game FILE]
#
# A native game runs on a virtual X display (Xvfb) with real key presses from xdotool, and the test
# reads two witnesses: the game's own "TEST: menu N" lines (-testmenu, src/testhooks.c: 701 for the
# sound menu opened by F4, -1 for no menu) and the picture (screenshots of the X display: the red
# of the sound menu's names is counted; holding Up turns the view, which is counted as changed pixels).
# Before the fix F4 left the game in a menu that was never drawn and that Escape did not close: the
# red pixels did not appear and Up changed nothing afterwards. About 40 s.
#
# Needs Xvfb, xdotool, ImageMagick's import and Python 3 with PIL; without them it prints NOT RUN and
# exits 3 (the convention of tests/web/determinism.js and firefox.js; the Makefile reports it and goes on).
# The browser test, tests/web/menu-keys.js, is the main one.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

game="$root/duke3d"
while [ $# -gt 0 ]; do
    case "$1" in
        --game) game="$2"; shift 2 ;;
        *) echo "unknown option $1" >&2; exit 2 ;;
    esac
done
for tool in Xvfb xdotool import; do
    command -v "$tool" >/dev/null || { echo "menu-f4: NOT RUN: $tool is not installed"; exit 3; }
done
python3 -c 'import PIL' 2>/dev/null || { echo "menu-f4: NOT RUN: Python PIL is not installed"; exit 3; }
t_need_data

wd="$t_tmp/game"
shots="$t_tmp/shots"
mkdir -p "$wd" "$shots"
# A first headless run only to make the work directory and its duke3d.cfg (music off), as run-headless.sh does.
"$root/scripts/run-headless.sh" --game "$game" --workdir "$wd" --timeout 4 -nosetup >/dev/null 2>&1
rm -f "$wd/duke3d.log"

# Xvfb picks a free display number itself and reports it on a pipe (-displayfd).
Xvfb -displayfd 3 -screen 0 800x600x24 -nolisten tcp 3>"$t_tmp/display" >"$t_tmp/xvfb.log" 2>&1 &
t_pids+=("$!")
for i in $(seq 1 100); do [ -s "$t_tmp/display" ] && break; sleep 0.1; done
[ -s "$t_tmp/display" ] || { echo "Xvfb did not report a display:"; cat "$t_tmp/xvfb.log"; exit 125; }
display=":$(head -1 "$t_tmp/display")"

(
    cd "$wd" && exec env DISPLAY="$display" HOME="$wd" SDL_AUDIODRIVER=dummy "$game" -nosetup -v1 -l1 -s1 -testmenu
) >"$t_tmp/game.out" 2>&1 &
game_pid=$!
t_pids+=("$game_pid")

export DISPLAY="$display"
log="$wd/duke3d.log"
menu_is() { t_wait_for "$log" "TEST: menu $1\$" 10 && [ "$(grep -o 'TEST: menu -\?[0-9]*' "$log" | tail -1)" = "TEST: menu $1" ]; }
shot() { import -window root "$shots/$1.png" 2>/dev/null; }
key() { xdotool key --delay 150 "$@"; }

t_check "a level is running (the game reports no menu)" t_wait_for "$log" 'TEST: menu -1$' 60
sleep 3
xdotool mousemove 400 300
sleep 1

# pixels.py: red NAME | diff A B | (numbers on stdout)
cat > "$t_tmp/pixels.py" <<'PY'
import sys
from PIL import Image, ImageChops
def red(f):
    im = Image.open(f).convert('RGB')
    return sum(1 for r, g, b in im.getdata() if r > 150 and g < 110 and b < 90)
def diff(a, b):
    d = ImageChops.difference(Image.open(a).convert('RGB'), Image.open(b).convert('RGB'))
    return sum(1 for r, g, b in d.getdata() if r + g + b > 60)
if sys.argv[1] == 'red': print(red(sys.argv[2]))
else: print(diff(sys.argv[2], sys.argv[3]))
PY
px() { python3 -I -W ignore "$t_tmp/pixels.py" "$@"; }
# the picture changes by holding Up for 0.7 s: count the pixels that changed
walk() {   # NAME: screenshots NAME-a and NAME-b around the walk
    shot "$1-a"; xdotool keydown Up; sleep 0.7; xdotool keyup Up; sleep 0.3; shot "$1-b"; px diff "$shots/$1-a.png" "$shots/$1-b.png"
}

shot level
red0="$(px red "$shots/level.png")"
moved0="$(walk w0)"
t_check "the keyboard moves the player ($moved0 pixels changed with Up held)" test "$moved0" -gt 20000

for round in 1 2; do
    key F4
    t_check "round $round: F4 opens the sound menu (the game reports menu 701)" menu_is 701
    sleep 0.8; shot "f4-$round"
    red1="$(px red "$shots/f4-$round.png")"
    t_check "round $round: the sound menu is drawn ($red1 red pixels, $red0 before)" test "$red1" -gt $((red0 + 2500))
    key Escape
    t_check "round $round: Escape closes the menu (the game reports menu -1)" menu_is -1
    sleep 0.8
    moved="$(walk "w$round")"
    t_check "round $round: the player can move again ($moved pixels changed with Up held)" test "$moved" -gt 20000
done

kill -0 "$game_pid" 2>/dev/null; t_check "the game is still running" test $? -eq 0
t_result
