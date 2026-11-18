#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
#
# Build the game as it was before brief 01 into $JFDUKE3D_CACHE/baseline-<commit>
# (default ~/.cache/jfduke3d-browser),
# for tests/net/test-udp-unchanged.sh to compare against. Prints the path of
# the baseline `duke3d` on its last line. Needs network access to the submodule
# forks (it checks out jfbuild, jfaudiolib, jfmact and vnet at the pinned commits).
#
#   tests/net/build-baseline.sh [commit]     (default: $JFDUKE3D_BASELINE, else 7e0cd72)
#
# The default is fixed: 7e0cd72 is `claude` just before brief 01 was merged (the game is
# upstream's, unchanged; jfbuild already has the relay, so what is compared is the game's
# own 01 changes: the argument handling, the shareware gate, the log, the hooks). It must not be
# worked out from `claude` (it used to be the merge-base of HEAD and claude):
# once brief 01 is on `claude`, that commit already has the relay code, and
# its game changes are part of what is being compared.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cache="${JFDUKE3D_CACHE:-$HOME/.cache/jfduke3d-browser}"

PRE_BRIEF_01=7e0cd72
base="${1:-${JFDUKE3D_BASELINE:-$PRE_BRIEF_01}}"
base="$(git -C "$root" rev-parse -q --verify --short "$base^{commit}")" || {
    echo "baseline commit ${1:-${JFDUKE3D_BASELINE:-$PRE_BRIEF_01}} not found: fetch more history (git fetch origin claude) or give a commit" >&2; exit 1; }
# (brief 01 added tests/net/; jfbuild is a submodule, so look at this repo's tree)
if git -C "$root" ls-tree -r "$base" -- tests/net/lib.sh | grep -q .; then
    echo "baseline $base already has brief 01's relay code: give a commit from before brief 01" >&2; exit 1
fi
dir="$cache/baseline-$base"

if [ ! -x "$dir/duke3d" ]; then
    mkdir -p "$cache"
    if [ ! -d "$dir" ]; then git -C "$root" worktree add --detach "$dir" "$base" >&2; fi
    ( cd "$dir" && git submodule update --init jfbuild jfaudiolib jfmact ext/vnet >&2 && make -j4 duke3d >&2 )
fi
[ -x "$dir/duke3d" ] || { echo "baseline build failed" >&2; exit 1; }
echo "$dir/duke3d"
