#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Reads the per-tic files written by -testdump<name> (src/testhooks.c): 32 bytes a tic, eight
# little endian 32 bit words: tic, randomseed, then the hashes of the players, sprites, hittype,
# sectors, walls and the rest of the simulation's state.
#
#   tests/tools/testdump.py diff A B     first tic at which the two files differ and in which
#                                        parts (exit 0 if they are the same, 1 if not, 2 on error)
#   tests/tools/testdump.py show FILE [N]   the first N records (default 5)
#   tests/tools/testdump.py count FILE   number of records
import struct
import sys

NAMES = ("tic", "seed", "players", "sprites", "hittype", "sectors", "walls", "other")
REC = 32


def load(path):
    with open(path, "rb") as f:
        data = f.read()
    if len(data) % REC:
        print("%s: %d bytes is not a whole number of %d-byte records" % (path, len(data), REC), file=sys.stderr)
        sys.exit(2)
    return [struct.unpack_from("<8I", data, i) for i in range(0, len(data), REC)]


def main(argv):
    if len(argv) >= 4 and argv[1] == "diff":
        a, b = load(argv[2]), load(argv[3])
        n = min(len(a), len(b))
        for i in range(n):
            if a[i] != b[i]:
                parts = [NAMES[k] for k in range(8) if a[i][k] != b[i][k]]
                print("first difference at record %d (tic %d): %s" % (i + 1, a[i][0], ", ".join(parts)))
                return 1
        if len(a) != len(b):
            print("the first %d records agree, but one file has %d records and the other %d" % (n, len(a), len(b)))
            return 1
        print("same: %d records" % n)
        return 0
    if len(argv) >= 3 and argv[1] == "show":
        recs = load(argv[2])
        for r in recs[: int(argv[3]) if len(argv) > 3 else 5]:
            print(" ".join("%s=%08x" % (NAMES[k], r[k]) for k in range(8)))
        return 0
    if len(argv) == 3 and argv[1] == "count":
        print(len(load(argv[2])))
        return 0
    print(__doc__.strip(), file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
