#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Fetch and verify the Duke Nukem 3D shareware 1.3D data used for testing.
#
#   scripts/fetch-test-data.sh                   # -> testdata/duke3dshare.grp
#   scripts/fetch-test-data.sh --dest DIR        # write DIR/duke3dshare.grp instead
#   scripts/fetch-test-data.sh --from-zip FILE   # use a local 3dduke13.zip, no download
#   scripts/fetch-test-data.sh --md5 HEX         # the one MD5 the zip must have (tests only)
#
# Downloads 3dduke13.zip (two releases of it exist, see below), checks its MD5, takes
# DUKE3D.GRP out of it and checks the GRP against the "Shareware Version" entry of
# src/grpscan.c: CRC32 0x983AD923, 11,035,779 bytes. Everything is built in a temporary
# directory beside the destination and moved into place only when every check has
# passed, so an unverified file is never left at the destination (an invalid file that
# is already there is removed). Does nothing when a valid file is already there. Exits
# non-zero on any failure. testdata/ is git-ignored: game data is never committed.
#
# The two zips (both are 3D Realms' own release, both hold the same DUKE3D.GRP):
#   dosgamesarchive.com  MD5 29b2f40990069d9cb0dbaf0f811d1118, an installer set:
#                        INSTALL.EXE, DUKE3DS._1 .. DUKE3DS._5 (the five parts, joined in
#                        order, are one zip file holding the game's files);
#   archive.org          MD5 04e4ca70b8a2d59ed56c451c5c1d5d39, INSTALL.EXE, LICENSE.TXT,
#                        DN3DSW13.SHR (a zip holding the game's files).
# Either is accepted with --from-zip; the layout is recognised by the zip's contents.
set -euo pipefail

# url|md5 of the zip, tried in this order
SOURCES=(
    "https://image.dosgamesarchive.com/games/3dduke13.zip|29b2f40990069d9cb0dbaf0f811d1118"
    "https://archive.org/download/3dduke13/3dduke13.zip|04e4ca70b8a2d59ed56c451c5c1d5d39"
)
GRP_NAME="duke3dshare.grp"
GRP_MEMBER="DUKE3D.GRP"
GRP_CRC="983ad923"
GRP_SIZE=11035779

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest="$root/testdata"
from_zip=""
only_md5=""

while [ $# -gt 0 ]; do
    case "$1" in
        --dest) [ $# -ge 2 ] || { echo "--dest needs a directory" >&2; exit 2; }; dest="$2"; shift 2 ;;
        --from-zip) [ $# -ge 2 ] || { echo "--from-zip needs a file" >&2; exit 2; }; from_zip="$2"; shift 2 ;;
        --md5) [ $# -ge 2 ] || { echo "--md5 needs a hex string" >&2; exit 2; }; only_md5="$2"; shift 2 ;;
        -h|--help) sed -n '2,/^set -euo/p' "${BASH_SOURCE[0]}" | sed '$d;s/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
    esac
done

die() { echo "fetch-test-data: $*" >&2; exit 1; }

# crc32 of a file as 8 lower-case hex digits
crc32_of() {
    python3 -I -c 'import sys, zlib
c = 0
with open(sys.argv[1], "rb") as f:
    for b in iter(lambda: f.read(1 << 20), b""):
        c = zlib.crc32(b, c)
print("%08x" % (c & 0xffffffff))' "$1"
}

size_of() { wc -c < "$1" | tr -d ' '; }

# 0 when $1 is the verified shareware GRP
grp_ok() {
    [ -f "$1" ] && [ "$(size_of "$1")" = "$GRP_SIZE" ] && [ "$(crc32_of "$1")" = "$GRP_CRC" ]
}

# 0 when the MD5 $2 of a zip is one we accept (the one from --md5, or either release's)
md5_ok() {
    local s
    if [ -n "$only_md5" ]; then [ "$2" = "$only_md5" ]; return; fi
    for s in "${SOURCES[@]}"; do [ "$2" = "${s#*|}" ] && return 0; done
    return 1
}

# extract_grp ZIP OUT: write DUKE3D.GRP from either layout of 3dduke13.zip to OUT
extract_grp() {
    python3 -I -c '
import io, sys, zipfile
zpath, out, member = sys.argv[1:4]
def fail(msg):
    sys.stderr.write("fetch-test-data: " + msg + "\n")
    sys.exit(1)
try:
    z = zipfile.ZipFile(zpath)
    names = set(z.namelist())
    if "DN3DSW13.SHR" in names:                      # archive.org: a zip inside the zip
        inner = zipfile.ZipFile(io.BytesIO(z.read("DN3DSW13.SHR")))
    elif "DUKE3DS._1" in names:                      # dosgamesarchive: one zip in five parts
        parts = [n for n in sorted(names) if n.startswith("DUKE3DS._")]
        inner = zipfile.ZipFile(io.BytesIO(b"".join(z.read(n) for n in parts)))
    else:
        fail("%s holds neither DN3DSW13.SHR nor DUKE3DS._1 (is it 3dduke13.zip?)" % zpath)
    if member not in inner.namelist():
        fail("%s is not in the game archive inside the zip" % member)
    with open(out, "wb") as f:
        f.write(inner.read(member))
except (zipfile.BadZipFile, KeyError, EOFError, OSError, ValueError) as e:
    fail("the zip is damaged: %s" % e)
' "$1" "$2" "$GRP_MEMBER"
}

need=(python3 md5sum mktemp)
[ -n "$from_zip" ] || need+=(curl)
for t in "${need[@]}"; do
    command -v "$t" >/dev/null 2>&1 || die "$t is required but not installed (scripts/setup.sh installs it)"
done

mkdir -p "$dest"
# leftovers of a run that was killed (the only run using this directory, we assume)
rm -rf "$dest"/.fetch.??????
out="$dest/$GRP_NAME"

if [ -e "$out" ]; then
    if grp_ok "$out"; then
        echo "$out is already there and verified (CRC32 0x${GRP_CRC^^}, $GRP_SIZE bytes)"
        exit 0
    fi
    echo "removing $out: it is not the shareware GRP" >&2
    rm -f "$out"
fi

tmp="$(mktemp -d "$dest/.fetch.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

zip="$tmp/3dduke13.zip"
if [ -n "$from_zip" ]; then
    [ -f "$from_zip" ] || die "$from_zip does not exist"
    cp "$from_zip" "$zip"
    have="$(md5sum "$zip" | cut -d' ' -f1)"
    md5_ok "$zip" "$have" || die "MD5 of the zip is $have, which is not a known 3dduke13.zip"
else
    got=0
    for src in "${SOURCES[@]}"; do
        url="${src%|*}"
        echo "downloading $url"
        if curl -fsSL --retry 2 --connect-timeout 20 -o "$zip" "$url"; then
            have="$(md5sum "$zip" | cut -d' ' -f1)"
            if md5_ok "$zip" "$have"; then
                got=1
                break
            fi
            echo "MD5 of the download from $url is $have, which is not a known 3dduke13.zip" >&2
        else
            echo "failed: $url" >&2
        fi
    done
    [ "$got" = 1 ] || die "could not download a verified 3dduke13.zip from any URL"
fi

extract_grp "$zip" "$tmp/$GRP_NAME" || die "could not take $GRP_MEMBER out of the zip"

[ "$(size_of "$tmp/$GRP_NAME")" = "$GRP_SIZE" ] || die "$GRP_MEMBER is $(size_of "$tmp/$GRP_NAME") bytes, expected $GRP_SIZE"
have="$(crc32_of "$tmp/$GRP_NAME")"
[ "$have" = "$GRP_CRC" ] || die "CRC32 of $GRP_MEMBER is 0x${have^^}, expected 0x${GRP_CRC^^}"

mv "$tmp/$GRP_NAME" "$out"
echo "wrote $out (CRC32 0x${GRP_CRC^^}, $GRP_SIZE bytes, Shareware Version)"
