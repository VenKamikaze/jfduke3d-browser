#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Makes a modified copy of the shareware GRP for the tests (never committed; the tests make it at run
# time from testdata/duke3dshare.grp). Prints the copy's CRC32 (8 hex digits, upper case).
#
#   tests/net/modgrp.py registered IN OUT   # DUKESW.BIN renamed DUKEREG.BIN
#
# grpscan.c no longer knows the file (its CRC is not in the table), and the game, which guesses
# shareware from a DUKESW.BIN entry when it cannot identify a GRP (game.c, app_main), takes it for
# registered data. The shareware gate (D14) must then let network games through by default; the
# level data is the shareware's, so a game still plays.
import struct
import sys
import zlib


def rename(f, old, new):
    n = struct.unpack('<I', f[12:16])[0]
    for i in range(n):
        if bytes(f[16 + 16 * i:28 + 16 * i]).rstrip(b'\0') == old:
            f[16 + 16 * i:28 + 16 * i] = new.ljust(12, b'\0')
            return
    sys.exit('no ' + old.decode())


mode, src, dst = sys.argv[1:4]
f = bytearray(open(src, 'rb').read())
if f[:12] != b'KenSilverman':
    sys.exit('not a GRP: ' + src)
if mode != 'registered':
    sys.exit('unknown mode ' + mode)
rename(f, b'DUKESW.BIN', b'DUKEREG.BIN')
open(dst, 'wb').write(f)
print('%08X' % (zlib.crc32(bytes(f)) & 0xffffffff))
