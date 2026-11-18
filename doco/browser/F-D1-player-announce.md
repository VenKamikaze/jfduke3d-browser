# F-D1: A relayed player announcement is filed under the wrong player (D1)

## Goal

In a network game of three or more players, every machine holds every player's announced settings: name, weapon order, aim mode, auto-aim and weapon-switch mode. The fix is small and upstream-friendly, on a branch from `master`, and goes into `claude` through an integration branch. `-testdump` hashes the fields again, and a test with a different configuration for every player proves it.

Found by brief 01's first 3-player `-testdump` (the `players` hash differed at tic 1), confirmed by an independent review. Game-breaking candidate: the simulation reads these fields.

## Scope

1. **The fix, on `fix/net-player-announce` from `master`** (`55c5f95`): `getpackets()`, `case 6`, in `src/game.c`.
   - On a slave, a packet 6 that comes from the master is about the player in `packbuf[1]` (the master re-sends it for another slave). File the name, `ud.wchoice`, `aim_mode`, `auto_aim` and `weaponswitch` under that index.
   - Anything else (on the master, in peer-to-peer mode) is filed under the sender, as before, so a slave cannot announce for another player. The old "mismatched index" log line stays for that case.
   - An index out of range is ignored (`break`).
2. **Audit every other packet case** in `getpackets()` for the same pattern (`other` used where the packet carries an index).
3. **Check the sender** sets its own entry (`getnames()`), so the fix neither double-applies nor misses the local player.
4. **Integration branch `browser/F-D1-player-announce` from `claude`**: merge the fix with `--no-ff`; put `aim_mode`, `auto_aim`, `weaponswitch`, `ud.wchoice` and the name into the `-testdump` hash (`src/testhooks.c`); add `tests/net/test-player-announce.sh` to `make test-net`; update `bugs.md`, `code-facts.md`, `building.md`, `README.md`, `PROMPT.md`.

## Out of scope

- Settings that change after the announcement (`aim_mode`, `auto_aim` and `weaponswitch` are sent once; the menu greys the three options out in a game or with more than one player, `menues.c:2226-2241`). `code-facts.md` 12 item 8 stands.
- `loogiex`/`loogiey` stay out of the hash (`actors.c:2498` reads the local screen size).
- The other states in `code-facts.md` 15.3 (A1).
- Sending anything upstream (no pull request, no issue).

## Acceptance criteria

1. In 3-player and 4-player relay games and a 3-player plain UDP game, with a different configuration for every player, every machine's state dump shows, for every player, that player's own name, 10 weapon choices, `auto_aim`, `weaponswitch` and (first tic) `aim_mode`.
2. The `-testdump` records of every tic, now including these fields, are identical on every machine.
3. The test fails on a build without the fix, on the slaves' entries and on the dumps.
4. `fix/net-player-announce` has one commit, only `src/game.c`, a message for upstream, no session trailer (only `Co-Authored-By: Claude Opus 5.5`), line endings kept, and cherry-picks onto `master` without a conflict.
5. All of `make test-net` passes (the 2-player game, the demo playback and the plain UDP tests are the proof that nothing else changed).

## Tests

`tests/net/test-player-announce.sh [--game FILE] [--tics N] [--only relay-3|relay-4|udp-3]`, in `make test-net` after `test-desync.sh`. About 90 s (three games of 200 tics, 3 to 4 processes each).

- Each player's `duke3d.cfg` (in its work directory) sets `PlayerName`, `MouseAiming` (the announced aim mode), `AutoAim`, `WeaponSwitchMode` and `WeaponChoice0` to `9`. Names, weapon orders and weapon-switch modes are different for all four; (`MouseAiming`, `AutoAim`) is `(0,1) (1,0) (1,1) (0,0)`.
- Which configuration belongs to which slot is read from each game's `player I of P` line (the slot a joiner takes is the order its first packet reaches the master).
- `-teststate150` makes every machine write the text state at tics 1, 2 and 150; a small Python check compares, on every machine, every player's `name`, `wchoice0..9`, `auto_aim`, `weaponswitch` and (tic 1 only: from then on the game takes `aim_mode` from the input) `aim_mode` with the configuration. The `-testdump` files are compared byte for byte.
- Each game must exit 0, log no `OUT OF SYNC` and no version mismatch, reach the tic, and the players are numbered 0 to N-1.

## Dependencies

Brief 01 (`-testdump`, `-teststate`, the relay and the test library).

## Notes

- **The audit.** Packet cases in `getpackets()`: 0 (master's input, from the master), 1 (a slave's input, only the master receives it), 16/17 (peer mode, the sender's input), 4 and 5, 7, 8 (messages and level starts: no player in them, or the target in `packbuf[1]` already used as such), 126 (`loadplayer`: the player is `packbuf[2]`, used), 250 (`playerreadyflag[other]`: a slave sends it only to the master, the master sends its own to the slaves, so `other` is the one who said it), 255. **Only packet 6 had the bug.** `getnames()` (the sender) sets `ps[myconnectindex]` and `ud.wchoice[myconnectindex]` locally before sending, and the master does not send a slave's packet back to that slave (`i != other`), so the local player's entry is neither missed nor overwritten.
- **Why `other == connecthead` and not "the packet says so".** A slave only ever receives packets from the master, and the master never receives its own, so `!networkmode && other == connecthead` is exactly "a slave got it from the master". The master and peer mode keep using the sender, because the index in a packet from a slave is not to be trusted.
- **Upstream check.** jonof/jfduke3d `master` is still `55c5f95` (`git ls-remote` on 18 Nov 2026), so there is no newer commit and no fix. Upstream's open pull requests were **not** checked: the session has no access to `jonof/jfduke3d` through the GitHub tools (`add_repo` was refused), so only `git ls-remote` was possible. The coordinator can check them.
- **`ud.wchoice[0]`** on a slave is the local weapon order (read from the config) until the master's announcement arrives, and then the master's: a slave's own is copied to `ud.wchoice[myconnectindex]` and sent before that (`getnames()`). Unchanged by the fix, harmless, and the reason the sender's own copy is in `[myconnectindex]`.
- **Demos.** Packet 6 is only handled in network games (`getpackets()` returns at once with fewer than two players), so single player and demo playback are unchanged; `test-single` (demo playback, identical dumps) is in `make test-net`. The native-against-wasm check of brief 02's list is brief 03's (README, status table).
- **Old and new builds in one game.** The wire format is unchanged. A slave without the fix mixed with a master with the fix is still wrong on that slave (it files by sender); that is today's behaviour. No version byte change: the bug is a receiver's, and the browser build is new.

## Outcome

Status: **review** (branch `browser/F-D1-player-announce`; the coordinator marks it done after review and merge).

**Commits.**

- `fix/net-player-announce` (pushed): `2ae8fc5`, one commit from `master` `55c5f95`, only `src/game.c` (17 insertions, 9 deletions), ASCII/LF as before (`file src/game.c`: "C source, ASCII text" before and after), trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` only. Cherry-picked onto a detached worktree of `master`: clean, tree identical to the fix branch's.
- `browser/F-D1-player-announce` (pushed): `dd537a7` (the `--no-ff` merge of the fix), `8871c04` (the hash, the test, `make test-net`, `building.md`), and the documents commit that holds this Outcome (`git log`).

**The fix.** In `case 6`: a new local `who` is the sender (`other`); when `!networkmode && other == connecthead` (a slave, packet from the master) it is `packbuf[1]`, and a value of `MAXPLAYERS` or more ignores the packet. The name, `ud.wchoice[who]`, `ps[who].aim_mode`, `auto_aim` and `weaponswitch` and the "too short" log line use `who`. Otherwise the "mismatched index" log line is kept.

**`-testdump`.** `aim_mode`, `auto_aim`, `weaponswitch`, `ud.wchoice[0..9]` and the name (one value per character, up to the end) are in the `players` hash and in the `-teststate` text, for every connected player. `loogiex`/`loogiey` were never in it and stay out.

**The test fails without the fix** (the same test files, `--game` a build of `claude`'s `game.c`, i.e. without the fix; the fixed binary passes). 20 checks fail:

| Scenario | Failing checks |
|---|---|
| `relay-3` | each of the 3 machines logs `OUT OF SYNC` (the sync byte covers the hash now); slave 1's state has the master's name, weapon order, weapon switch and aim mode of the other slave (`player 0 name is CHARLIE, want ALPHA`) and nothing for player 2 (`name is empty`, `wchoice` all 0); machines 1 and 2's `-testdump` differ from the host's at record 1, `players` |
| `relay-4` | the same: 4 `OUT OF SYNC`, the state check, 3 dump differences |
| `udp-3` | the same as `relay-3` |

**Results.** `make test-net` (from the branch, under `flock`): all 12 invocations pass, 317 `ok` lines, 0 `FAIL` (about 17 minutes; `GAME_RUNS=1`).

| Test | Result |
|---|---|
| `test-player-announce` (new) | passes: `relay-3` 117 values checked, `relay-4` 208, `udp-3` 117, every machine; all exit 0, no desync, `-testdump` of 200 tics identical on every machine. 3 full runs and 9 runs of `udp-3` alone: all pass |
| `test-three-games` relay 3 players, 2 players, 4 players, relay with impairment (600 tics), plain UDP | pass; the dumps are identical with the announced settings now in the `players` hash |
| `test-desync` | passes (the `players` part still shows the nudge first) |
| `test-single` | passes (single player and demo playback unchanged: identical dumps, `-testquit` exits 0) |
| `test-udp-unchanged` | passes (the wire format is the same as the pre-brief build's) |
| `test-errors`, `test-relay-lost`, `test-shareware-gate` | pass |

**Open.** Nothing in the fix. The earlier first run of `udp-3` once showed both slaves stuck one tic short of `-testquit` (the master had quit first; they were killed by the timeout) and it did not recur in 9 further runs of that scenario and 3 full runs: the quit race of plain UDP games that `test-three-games.sh --udp` has too, noted here only. Weapon-switch and auto-aim changes in the menu during a network game are blocked by the menu (see Out of scope); not rechecked.
