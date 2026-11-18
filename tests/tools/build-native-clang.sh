#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Builds the native game with clang, in a copy of the tree outside it, and prints the path of the binary.
#
#   tests/tools/build-native-clang.sh            # prints .../native-clang/duke3d
#   NATIVE_CLANG_DIR=/some/dir tests/tools/build-native-clang.sh
#
# Why: the C standard does not say in which order the arguments of a call are evaluated, and the game has calls whose arguments
# are each a call of the random number generator (RANDOMSCRAP in src/duke3d.h, bugs.md D15). gcc (the native build) and clang
# (Emscripten's compiler) take them in opposite orders, so the same demo gives different sprites in the two builds. A clang native
# build evaluates them like the wasm build does, which lets tests/web/determinism.js tell that difference from any other between
# the native game and the browser's. The copy is made with rsync (sources with their times, so make rebuilds only what changed) and
# lives in $XDG_CACHE_HOME/jfduke3d-browser/native-clang unless NATIVE_CLANG_DIR says otherwise; the tree itself is not touched.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dest="${NATIVE_CLANG_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/jfduke3d-browser/native-clang}"

command -v clang >/dev/null || { echo "build-native-clang: clang not found" >&2; exit 1; }
command -v clang++ >/dev/null || { echo "build-native-clang: clang++ not found" >&2; exit 1; }
command -v rsync >/dev/null || { echo "build-native-clang: rsync not found" >&2; exit 1; }
mkdir -p "$dest"
# Objects, libraries and binaries of the tree itself (gcc's, wasm's) stay out; the copy's own are not deleted.
rsync -a --exclude=/.git --exclude=.git --exclude=/build-wasm --exclude=/testdata --exclude='*.o' --exclude='*.a' \
    --exclude=/duke3d --exclude=/build --exclude='/jfbuild/bin2c' --exclude='*.wasm.*' "$root/" "$dest/"
cd "$dest"
make -j4 CC=clang CXX=clang++ duke3d >"$dest/build.log" 2>&1 || { tail -20 "$dest/build.log" >&2; echo "build-native-clang: the build failed (log: $dest/build.log)" >&2; exit 1; }
echo "$dest/duke3d"
