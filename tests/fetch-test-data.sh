#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Tests for scripts/fetch-test-data.sh.
#
#   tests/fetch-test-data.sh [DOSGAMESARCHIVE-3dduke13.zip [ARCHIVE.ORG-3dduke13.zip]]
#
# The two zips (see the script's header: two releases of 3dduke13.zip exist) come from
# the arguments, then $JFDUKE3D_TEST_ZIP and $JFDUKE3D_TEST_ZIP2, then a download from
# the script's two URLs. Everything else is built in a temporary directory.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="$root/scripts/fetch-test-data.sh"
work="$(mktemp -d)" || { echo "mktemp failed" >&2; exit 2; }
[ -n "$work" ] && [ -d "$work" ] || exit 2
trap 'rm -rf -- "$work"' EXIT

pass=0
fail=0
ok()  { pass=$((pass + 1)); echo "ok   - $1"; }
bad() { fail=$((fail + 1)); echo "FAIL - $1"; }

# runs the script, keeps its output in $out and its status in $rc
run() {
    out="$("$script" "$@" 2>&1)"
    rc=$?
}
expect_rc0()  { [ "$rc" = 0 ] && ok "$1" || { bad "$1 (exit $rc)"; echo "$out" | sed 's/^/       /'; }; }
expect_fail() { [ "$rc" != 0 ] && ok "$1 (exit $rc)" || { bad "$1 (exited 0)"; echo "$out" | sed 's/^/       /'; }; }
expect_msg()  { case "$out" in *"$2"*) ok "$1: message mentions '$2'" ;; *) bad "$1: message lacks '$2'"; echo "$out" | sed 's/^/       /' ;; esac; }
# nothing in DIR: no duke3dshare.grp, no .fetch.* leftovers
expect_empty() {
    if [ -z "$(ls -A "$2")" ]; then ok "$1: nothing left in the destination"
    else bad "$1: destination holds: $(ls -A "$2" | tr '\n' ' ')"; fi
}

# ---- the zips ----
MD5_A=29b2f40990069d9cb0dbaf0f811d1118   # dosgamesarchive.com: INSTALL.EXE + DUKE3DS._1 .. _5
MD5_B=04e4ca70b8a2d59ed56c451c5c1d5d39   # archive.org: INSTALL.EXE + LICENSE.TXT + DN3DSW13.SHR
zip="${1:-${JFDUKE3D_TEST_ZIP:-}}"
zip2="${2:-${JFDUKE3D_TEST_ZIP2:-}}"
if [ -z "$zip" ]; then
    zip="$work/a.zip"
    curl -fsSL --retry 2 -o "$zip" https://image.dosgamesarchive.com/games/3dduke13.zip ||
        { echo "no zip given and the download failed" >&2; exit 2; }
fi
if [ -z "$zip2" ]; then
    zip2="$work/b.zip"
    curl -fsSL --retry 2 -o "$zip2" https://archive.org/download/3dduke13/3dduke13.zip ||
        { echo "no second zip given and the download failed" >&2; exit 2; }
fi
[ "$(md5sum "$zip" | cut -d' ' -f1)" = "$MD5_A" ] ||
    { echo "$zip is not the expected dosgamesarchive 3dduke13.zip (MD5 $MD5_A)" >&2; exit 2; }
[ "$(md5sum "$zip2" | cut -d' ' -f1)" = "$MD5_B" ] ||
    { echo "$zip2 is not the expected archive.org 3dduke13.zip (MD5 $MD5_B)" >&2; exit 2; }

# ---- the constants agree with src/grpscan.c ----
line="$(grep '"Shareware Version"' "$root/src/grpscan.c")"
crc="$(echo "$line" | sed -n 's/.*0x\([0-9A-Fa-f]*\), *\([0-9]*\),.*/\1/p' | tr A-F a-f)"
size="$(echo "$line" | sed -n 's/.*0x\([0-9A-Fa-f]*\), *\([0-9]*\),.*/\2/p')"
gname="$(echo "$line" | sed -n 's/.*"\([a-z0-9]*\.grp\)".*/\1/p')"
[ "$crc" = "$(sed -n 's/^GRP_CRC="\(.*\)"/\1/p' "$script")" ] && [ "$size" = "$(sed -n 's/^GRP_SIZE=\(.*\)/\1/p' "$script")" ] &&
    ok "script's CRC32 and size match src/grpscan.c ($crc, $size)" ||
    bad "script's CRC32/size differ from src/grpscan.c ($crc, $size)"
[ "$gname" = "$(sed -n 's/^GRP_NAME="\(.*\)"/\1/p' "$script")" ] &&
    ok "script's file name matches src/grpscan.c ($gname)" || bad "script's GRP name differs from src/grpscan.c ($gname)"

# ---- 1. good case, both releases of the zip ----
d="$work/good"
run --dest "$d" --from-zip "$zip"
expect_rc0 "good zip (dosgamesarchive layout)"
if [ -f "$d/duke3dshare.grp" ] && [ "$(wc -c < "$d/duke3dshare.grp")" = 11035779 ]; then ok "good zip: duke3dshare.grp has the right size"; else bad "good zip: duke3dshare.grp missing or wrong size"; fi
[ "$(ls -A "$d")" = duke3dshare.grp ] && ok "good zip: only duke3dshare.grp in the destination" || bad "good zip: destination holds: $(ls -A "$d" | tr '\n' ' ')"

d="$work/good2"
run --dest "$d" --from-zip "$zip2"
expect_rc0 "good zip (archive.org layout)"
cmp -s "$d/duke3dshare.grp" "$work/good/duke3dshare.grp" && ok "both layouts give the same GRP" || bad "the two layouts gave different GRPs"

# ---- 2. second run is a no-op (and needs no zip at all) ----
d="$work/good"
before="$(stat -c '%i %Y' "$d/duke3dshare.grp")"
run --dest "$d" --from-zip "$work/does-not-exist.zip"
expect_rc0 "second run"
expect_msg "second run" "already there"
[ "$before" = "$(stat -c '%i %Y' "$d/duke3dshare.grp")" ] && ok "second run: file untouched" || bad "second run: file was rewritten"

# ---- 3. truncated zip ----
d="$work/trunc"
head -c $(( $(wc -c < "$zip") / 2 )) "$zip" > "$work/trunc.zip"
run --dest "$d" --from-zip "$work/trunc.zip"
expect_fail "truncated zip"
expect_msg "truncated zip" "MD5"
expect_empty "truncated zip" "$d"

# ---- 4. one flipped byte ----
d="$work/flip"
python3 -I - "$zip" "$work/flip.zip" <<'PY'
import sys
b = bytearray(open(sys.argv[1], "rb").read())
b[len(b) // 2] ^= 0x01
open(sys.argv[2], "wb").write(b)
PY
run --dest "$d" --from-zip "$work/flip.zip"
expect_fail "zip with one flipped byte"
expect_msg "flipped byte" "MD5"
expect_empty "flipped byte" "$d"

# ---- 5. right size, wrong CRC (a fake zip with its own MD5 passed in) ----
# fake OUT.zip LAYOUT GRPSIZE: LAYOUT "shr" = DN3DSW13.SHR (a zip) holding DUKE3D.GRP of that
# size; "parts" = DUKE3DS._1 .. _3 that, joined, are a zip holding it; "none" = neither
fake() {
    python3 -I - "$1" "$2" "$3" <<'PY'
import io, sys, zipfile
out, layout, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
grp = bytes(size - 1) + b"\x01"           # zeros, so it compresses; not the real GRP
inner = io.BytesIO()
with zipfile.ZipFile(inner, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("DUKE3D.GRP", grp)
data = inner.getvalue()
with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as z:
    if layout == "shr":
        z.writestr("DN3DSW13.SHR", data)
    elif layout == "parts":
        n = len(data) // 3
        z.writestr("DUKE3DS._1", data[:n])
        z.writestr("DUKE3DS._2", data[n:2 * n])
        z.writestr("DUKE3DS._3", data[2 * n:])
    else:
        z.writestr("README.TXT", b"not the game")
PY
}
for layout in shr parts; do
    d="$work/crc-$layout"
    fake "$work/badcrc-$layout.zip" "$layout" 11035779
    run --dest "$d" --from-zip "$work/badcrc-$layout.zip" --md5 "$(md5sum "$work/badcrc-$layout.zip" | cut -d' ' -f1)"
    expect_fail "GRP of the right size and the wrong CRC ($layout layout)"
    expect_msg "wrong CRC ($layout)" "CRC32"
    expect_empty "wrong CRC ($layout)" "$d"
done

# ---- 6. wrong size ----
d="$work/size"
fake "$work/badsize.zip" shr 1000
run --dest "$d" --from-zip "$work/badsize.zip" --md5 "$(md5sum "$work/badsize.zip" | cut -d' ' -f1)"
expect_fail "GRP of the wrong size"
expect_msg "wrong size" "bytes"
expect_empty "wrong size" "$d"

# ---- 6b. a zip with the right MD5 (here: a made-up one) that is not 3dduke13.zip ----
d="$work/notgame"
fake "$work/notgame.zip" none 11035779
run --dest "$d" --from-zip "$work/notgame.zip" --md5 "$(md5sum "$work/notgame.zip" | cut -d' ' -f1)"
expect_fail "a zip that is not 3dduke13.zip"
expect_msg "not 3dduke13.zip" "DN3DSW13.SHR"
expect_empty "not 3dduke13.zip" "$d"

# ---- 6c. a zip with an MD5 nobody knows is refused before it is opened ----
d="$work/unknown"
run --dest "$d" --from-zip "$work/notgame.zip"
expect_fail "a zip with an unknown MD5"
expect_msg "unknown MD5" "not a known"
expect_empty "unknown MD5" "$d"

# ---- 7. a bad file already at the destination is removed on failure, replaced on success ----
d="$work/stale"
mkdir -p "$d"
cp "$work/good/duke3dshare.grp" "$d/duke3dshare.grp"
printf 'x' | dd of="$d/duke3dshare.grp" bs=1 seek=100 conv=notrunc 2>/dev/null   # one byte changed, same size
run --dest "$d" --from-zip "$work/trunc.zip"
expect_fail "stale bad GRP, bad zip"
expect_empty "stale bad GRP, bad zip" "$d"
cp "$work/good/duke3dshare.grp" "$d/duke3dshare.grp"
printf 'x' | dd of="$d/duke3dshare.grp" bs=1 seek=100 conv=notrunc 2>/dev/null
run --dest "$d" --from-zip "$zip"
expect_rc0 "stale bad GRP, good zip"
cmp -s "$d/duke3dshare.grp" "$work/good/duke3dshare.grp" && ok "stale bad GRP replaced by the verified one" || bad "stale bad GRP was not replaced"

# ---- 8. leftovers of a killed run are cleaned up ----
d="$work/stale2"
mkdir -p "$d/.fetch.abc123"; echo junk > "$d/.fetch.abc123/3dduke13.zip"
run --dest "$d" --from-zip "$zip"
expect_rc0 "run after a killed run"
[ ! -e "$d/.fetch.abc123" ] && ok "stale .fetch.* directory removed" || bad "stale .fetch.* directory left"

# ---- 9. a missing tool is reported up front and a valid GRP is not deleted ----
bin="$work/bin"; mkdir -p "$bin"
for t in bash env dirname basename cat sed tr cut wc rm mkdir mktemp cp mv md5sum ls head; do
    p="$(command -v "$t")" && ln -sf "$p" "$bin/$t"
done
d="$work/notool"; mkdir -p "$d"; cp "$work/good/duke3dshare.grp" "$d/duke3dshare.grp"
out="$(PATH="$bin" "$BASH" "$script" --dest "$d" --from-zip "$zip" 2>&1)"; rc=$?
expect_fail "python3 missing"
expect_msg "python3 missing" "python3 is required"
[ -f "$d/duke3dshare.grp" ] && ok "python3 missing: the valid GRP is still there" || bad "python3 missing: the GRP was deleted"

echo
echo "$pass passed, $fail failed"
[ "$fail" = 0 ]
