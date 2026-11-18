# 01: Native relay games, test hooks, shareware network gate

## Goal

Native players can create and join network games through a vnet relay by room code from jfDuke3D's own command line, using the game's existing master/slave networking, and a failed or lost relay game ends with a clear message. The game gets the test hooks the later briefs need (`-testquit`, `-testsync`, `-testnudge`, and `-testdump`, a per-tic record of the whole simulation state), and network games with the shareware GRP are refused unless the player allows them (decision D14). `make test`, `make test-mmulti` and `make test-net` run it all. The plain UDP path (`-net`) keeps working exactly as it does today.

This is the jfDuke3D twin of jfsw-browser's [brief 01](https://github.com/VenKamikaze/jfsw-browser/blob/claude/doco/browser/01-vnet-transport.md) and of the game's side of jfSW's brief 04 (`-testdump`) and L18. The engine half (the vnet-backed mmulti, `-relay`, `-host-room`, `-room`, the lobby) is already in the jfbuild fork that brief 00 pinned, so this brief changes **only the game** (`src/`, `Makefile*`, `tests/`, `doco/`): nothing in `jfbuild/`, `jfaudiolib/`, `jfmact/` or `ext/vnet`.

## Read first

- [`README.md`](README.md): D1 to D14 (D14 is added by this brief), "Working across repos".
- [`code-facts.md`](code-facts.md) §2 (the netcode), §3 (how `-net` reaches mmulti, the `VOLUMEONE` cap), §4 (the blocking loops), §6 (the GRP table) and the new §15 (what this brief learnt).
- The Outcome of [00](00-setup.md).
- jfsw-browser's brief 01 and its Outcome, and `src/sync.c`, `src/net.c`, `src/game.c` there (`-testquit`, `-testsync`, `-testnudge`, `-testdump`), `tests/net/`, and its `bugs.md` L18.
- `jfbuild/include/mmulti_vnet.h`: what the engine offers the game.

## Scope

### 1. Relay games from the command line

- `-net -relay HOST:PORT -host-room N` and `-net -relay HOST:PORT -room CODE` work through Duke's argument handling (`checkcommandline`, `app_main`). The arguments are read by mmulti (the `-net` branch of `checkcommandline` skips them, `code-facts.md` §3.2). Relay games are always master/slave (mmulti forces it and refuses `-np`). Plain UDP `-net` works as before.
- **Failures end with a message and exit status 1, not a hang.** A bad `-relay`/`-room`/`-host-room`, an unreachable relay, no such room, a full room, a host that never answers: `Network game failed: WHY` on stdout and in `duke3d.log`, a message box, exit 1 (jfSW's `InitGame` checks, in `app_main` and `Startup`). A plain `-net` that cannot start still falls back to a single player game, as before.
- **A relay session lost during a game** (the relay timed the player out or restarted, the room closed) ends the game the same way once nothing has moved for 2 s (jfSW's L18 fix, the game's half): `NetLostCheck()` in the main loop and in `waitforeverybody()`.
- `-relay`, `-room` and `-host-room` outside `-net` are refused with a message (the game's option parser would take them for `-r`, record a demo, and `-h`, a DEF file).
- `-host-room N` is limited by the game (4 with the shareware GRP, `MAXPLAYERS` otherwise: `mmulti_vnet_setplayercap` before the wait) and by the engine's own limit of 8 per room.

### 2. Test hooks (test-only; same names and semantics as jfSW's)

Marked test-only in `src/testhooks.h`, in `code-facts.md` §15 and here. All in `src/testhooks.c`.

- `-testquit<N>`: quit cleanly (exit status 0) after the N-th game tic of the level. Works in network games, single player and demo playback (jfSW's works in network games only).
- `-testsync`: every tic, not every 8th, each machine adds a sync byte, a fold of the hash of the whole simulation state (below), so the game's own sync check sees any divergence at once. Every player of a game must use it (it changes the version byte of packet 6, so a player without it is refused with "You cannot play Duke with different versions").
- `-testnudge<T>`: this player moves 8 units in x at tic T, a deliberate desync.
- `-testdump<name>`: this machine writes a record of every game tic to `<name>`, in network games, single player and demo playback. 32 bytes a tic, little endian words: the tic (1-based, from the start of the level), `randomseed`, and 32 bit FNV-1a hashes of the players (`ps[]`), the sprites (and the order of the status and sector lists), `hittype[]`, the sectors, the walls and the rest of the simulation's state. The record is taken in `domovethings()` before the tic is moved (after the previous tic, and after this tic's `-testnudge`) and flushed at once. What each hash covers, and what it deliberately leaves out (a machine's own state: drawing scratch fields, local audio bookkeeping, the kill statistics, the announced settings that bug D1 makes differ), is in `src/testhooks.c`.
- `-teststate[<T>]` (with `-testdump`): also `<name>.state`, the same fields as text at tics 1, 2 and T, for finding which field two machines disagree about. The text and the hashes are made from the same list.
- `tests/tools/testdump.py` reads the files (`diff A B` names the first tic and the parts that differ).

### 3. The out-of-sync warning is logged

`checksync()` draws "Out Of Sync" on the screen only. It now also logs `GAME OUT OF SYNC: sync check N (tic T), player P differs from the master` with `buildprintf`, once for each run of mismatches, and counts checks and mismatches (the tests read them from the `TEST: quitting` line).

### 4. D14, the shareware network gate

With the shareware GRP (`VOLUMEONE`) network games are refused by default, with a clear message, unless allowed: `[Comm Setup] AllowSharewareNetGames = 1` in `duke3d.cfg` (default 0, read and written by `config.c` like the other keys) or `-allowsharewarenet` on the command line (a test and page switch, not written to the file; it must come **before** `-net`, because mmulti reads what follows `-net` up to `--`). Registered data (any GRP that is not the shareware one) always allows network games. It applies to plain UDP and relay games alike, and to the startup window's Join and Host. The authoritative check runs in `app_main` once **every** group file is mounted (main GRP, the startup window's choice, `-g` extras, ZIPs): the data is shareware if `gametype` says so or a `DUKESW.BIN` can be opened from anywhere (`NetDataIsShareware()`; `gametype` itself is not changed). An early check, before anything is opened (so no relay room is made), only runs when no startup window can change the GRP afterwards, and refuses only what the authoritative one would. `NetGameAllowed()` is the one function a later entry point (the menu or the console's Host/Join, brief 05) must ask. The reason is the shareware licence's `[3][D]` (see `00-setup.md`, Outcome, "Licence"): online multiplayer services need 3D Realms' written permission, so shareware netplay is meant only for LAN deployments. The browser's `config.js` equivalent and hiding the menu and console entries are later briefs; the game-side switch is designed so the page can pass `-allowsharewarenet`.

### 5. Tests

`tests/net/lib.sh` and the scripts, `make test`, `make test-mmulti`, `make test-net` (below).

## Out of scope

The Emscripten build and the page (02); menus and console Host/Join (05); the data and build warning (05b); lag cuts (04b); the determinism audit and the level-exit fix (A1); fixing the bugs found (D1 below is for its own brief); changes to the forks or to vnet.

## Acceptance criteria

1. Native builds with both renderer settings, from a fresh recursive clone.
2. `make test` passes: `test-mmulti` (10 runs), `test-net` (below), `test-scripts`.
3. Relay games of 2, 3 and 4 players and a plain UDP game play at least 600 to 900 tics, quit by themselves with status 0, log no desync, make the expected number of sync checks, and every machine's `-testdump` is byte for byte the same.
4. A deliberate desync (`-testnudge`) is logged by the machines that compare and shows in `-testdump` at exactly the tic it happened, with and without `-testsync`.
5. `-testdump` and `-testquit` work in single player and in demo playback, and two runs give the same dump.
6. A bad relay argument, an unreachable relay, a missing or full room, a host that never answers or leaves during the wait, and **the local** relay session lost in a game each end with a message and exit status 1 within a bounded time. **Limitation:** a host (or any player) that vanishes in the middle of a game is not detected: the other players stand still for ever, as in jfSW (the lost-session check only sees this machine's own session). Not fixed here (`bugs.md`, L18's open half).
7. With the shareware GRP, every kind of network start is refused by default and allowed by the option (in the file and on the command line); with registered data it is allowed with no option.
8. Plain UDP is unchanged: the pre-01 game and the new one play together in every combination.
9. **Every new test fails without its fix**, shown by a mutation recorded in the Outcome.
10. `code-facts.md`, `bugs.md`, `building.md` and the decisions in `README.md` and `PROMPT.md` are updated.

## Tests

All in `tests/net/`, run by `make test` (they need `testdata/duke3dshare.grp`, `scripts/fetch-test-data.sh`, and Go for the relay; `lib.sh` builds it once from `ext/vnet/relay` into `~/.cache/jfduke3d-browser`). The game's tic is 30 Hz, so a 900-tic game takes 30 s.

| Script | What it proves | Make |
|---|---|---|
| `test-mmulti-vnet.sh` (+ `mmulti_peer.c`) | mmulti over vnet with loss, duplication and reordering, three processes (jfSW's test 1; the engine is shared) | `test-mmulti` |
| `test-three-games.sh` | 2, 3 and 4 game processes through a relay (also with impairment) and over plain UDP: co-op E1L1, `-testsync`, `-testquit`, no desync logged, enough sync checks, identical `-testdump`s | `test-net` |
| `test-desync.sh` | a `-testnudge` is caught by the sync check (log) and by `-testdump` (first record, players hash), with and without `-testsync`; machines that did not diverge stay equal | `test-net` |
| `test-single.sh` | `-testquit` and `-testdump` in single player and demo playback; two runs give the same dump | `test-net` |
| `test-udp-unchanged.sh` | plain UDP against the pre-01 build (`build-baseline.sh`): same mmulti lines, mixed old and new games play | `test-net` |
| `test-errors.sh` | relay errors and the player caps: message, exit 1, bounded time | `test-net` |
| `test-relay-lost.sh` | a relay session lost in a game ends it with the reason and exit 1 | `test-net` |
| `test-shareware-gate.sh` | the gate: refused by default (UDP, relay, file value 0), allowed by `-allowsharewarenet` and by the file, registered data allowed | `test-net` |

## Dependencies

00.

## Notes

- **Git:** this brief changes only jfduke3d-browser (`browser/01-native-relay`, from `claude`). The submodules are untouched.
- Brief 02 runs at the same time in another worktree and touches the `Makefile` (the wasm parts), the page and Duke's blocking loops. This brief's `Makefile` edits are two object names in `GAMEOBJS` and the test section at the end. The wasm build needs `netgame.c` and `testhooks.c` in its object list.
- `make test` runs `git worktree add` (once, `build-baseline.sh`) and needs network access to the submodule forks then.
- Heavy runs: one suite at a time (`flock /tmp/jfd-heavy-tests.lock`); the tests are real-time and a loaded machine slows them. The tests' ports default to 47400 and up (`JFDUKE3D_TEST_PORT_BASE`), jfSW's to 47100.
- **The D14 number.** The coordinator's prompt called the gate "D13"; the README already had D13 (file names), so it is **D14**.

## Outcome

Status: **review** (branch `browser/01-native-relay` in jfduke3d-browser; the coordinator marks it done after review and merge). Commits: `4eb9667` (the game: relay failures, the gate, the log, the hooks), `2bdbf14` (the tests), `1404cf8` (CRLF kept in `premap.c` and `Makefile.deps`, the tests find the game by its own name, the `-relay`-outside-`-net` case, docs); the last fix-up commits are on the branch. **The net diff against `claude` is clean**; the first commit alone shows `src/premap.c` as a whole-file change (my script wrote LF over CRLF; the third commit puts it back, `git diff claude -- src/premap.c` is two lines).

**What landed**

- *Relay games natively.* The engine already did the work (brief 00 found two unchanged builds joining a room); what the game lacked was handling: a bad `-relay`, `-host-room` or `-room` used to fall back to a single player game, a failed join was not reported, and a lost session left the game standing still. Now `Network game failed: WHY` (stdout, `duke3d.log`, message box) and exit 1 in `app_main` and `Startup()`; `NetLostCheck()` in the main loop and `waitforeverybody()` ends a game whose relay session is FAILED and has not moved for 2 s (jfSW's L18; 2 s after the resume in the test); `mmulti_vnet_setplayercap(4 or 16)`; `-relay`, `-room` and `-host-room` outside `-net` are refused (they would have started a demo recording and loaded a DEF file). Plain UDP is unchanged. Files: `src/netgame.c`/`.h`.
- *Test hooks* (`src/testhooks.c`/`.h`): `-testquit<N>`, `-testsync`, `-testnudge<T>`, `-testdump<name>`, and `-teststate[<T>]` (the state as text; not asked for, but the first 3-player difference could not be found without it, so it stayed). They work in network games, single player and demo playback. `tests/tools/testdump.py`.
- *The out-of-sync log*: `GAME OUT OF SYNC: sync check N (tic T), player P differs from the master`, once per run of mismatches; `NetSyncChecks`/`NetSyncMismatches`.
- *D14, the shareware gate* (`NetGameAllowed()`): see below.
- *Tests* and `make test`, `make test-mmulti`, `make test-net`; `building.md` §8; `code-facts.md` §15; `bugs.md` D1 and D2; D14 in `README.md` and `PROMPT.md`.
- Edits to existing files: `game.c` (about 60 lines: includes, argument handling, three call sites in `app_main`/`Startup`, one in the main loop, `TestTicHook`/`TestTicEnd`, the sync byte, the packet-6 version byte, `checksync()`), `premap.c` (2 lines), `config.c`/`config.h` (the key), `Makefile` (two objects and the test section), `Makefile.deps`, `Makefile.msvc`. The Xcode project was not touched.

**The `-testdump` format.** `<name>` in the game's working directory, flushed per tic: 32 bytes per game tic, eight little endian 32 bit words: `tic` (1-based, from the start of each level), `randomseed`, then FNV-1a hashes of `players`, `sprites` (and list order), `hittype`, `sectors`, `walls`, `other`; the state before the tic is moved, after this tic's `-testnudge`. What each covers and leaves out: `src/testhooks.c` and `code-facts.md` §15.2 to 15.3. `testdump.py diff A B` prints the first differing tic and parts. (jfSW's is 17 bytes: tic, nine sync bytes, one hash.)

**D14 configuration.** Config key `AllowSharewareNetGames` in `[Comm Setup]` of `duke3d.cfg` (0 or 1, default 0, read and written like the other keys; C name `AllowSharewareNet`); command line `-allowsharewarenet` (not written to the file; **before `-net`**, since mmulti reads what follows it to `--`). `NetGameAllowed()` / `NetGameAllowedFor(game)` in `src/netgame.h` is what the menu and console entries of brief 05 must ask. Refused games print "Network game refused: ..." with the licence reason and exit 1; checked twice (before `initmultiplayersparms`, so no relay room is made, and after the data is final, which covers the startup window and unidentified GRPs). Registered data (anything but the shareware GRP) is always allowed. The gate sits in the game, so a page passes the argument.

**Results** (`make test GAME_RUNS=3` from a clean tree on the branch: 0 failures; the whole suite about 14 minutes; also in the tests: 322 `ok` lines)

| Test | Result |
|---|---|
| `make test-scripts` (brief 00's) | 40 and 24 checks pass. (Run from a shell that ignores SIGINT, as a background job does, one check of `tests/run-headless.sh` "SIGINT to the script: its status" fails: an artefact of that shell, not of this brief; `make test` from a normal shell, or the Python launcher used here, passes.) |
| `test-mmulti` | 10 of 10 runs: every packet exactly once, in order, intact; all three agree on the players |
| `test-three-games --relay` (3 players, 900 tics) | 3 of 3 runs (`GAME_RUNS=3`): each machine 897 to 899 sync checks, 0 mismatches, all exit 0, three identical 900-record dumps |
| 2 and 4 players, relay | pass (900 tics, identical dumps) |
| 3 players, relay, `loss=3,dup=2,reorder=3,lat=10,jit=5` | passes (600 tics) |
| 3 players, plain UDP | passes (900 tics) |
| `test-desync` | passes: the nudged machine and the master log the desync at tic 300 with `-testsync` and within 8 tics without; the other slave logs none; the dumps first differ at record 300 in `players`; the machines that did not diverge stay identical |
| `test-single` | passes: two single player runs and two playbacks of a demo give identical 300-record dumps, `-testquit` exits 0 by itself |
| `test-udp-unchanged` | passes: all four mmulti combinations; the old and the new game print the same mmulti lines; old master with new slaves and new master with old slaves play 600 tics |
| `test-errors` | passes (47 checks), including the new `relay-outside-net` and `room-outside-net` |
| `test-relay-lost` | passes: the joiner exits 1 about 2 s after being resumed, "Network game failed: the relay ended the session" |
| `test-shareware-gate` | passes (25 checks): refused by default in four ways, relay made no room, file value 0 refuses, single player unaffected, allowed by the argument and by the file, two games play 100 tics, registered (a copy of the GRP that has no `DUKESW.BIN`) allowed |

Also: the software renderer build (`USE_POLYMOST=0 USE_OPENGL=0`) builds with 7 warnings (none in new code), the default with 12 (all brief 00's; none new), and from a fresh recursive clone of the branch; a single player run of the software build gives the same dump as the OpenGL build. A 3-player game ran 2795 tics without the hang jfSW found at tic 1522 (F1).

**Each new test fails without its fix** (a mutation of a copy of the source, or an old binary; the checks that failed):

| Test | Mutation | Result |
|---|---|---|
| `test-mmulti-vnet` | `--stub-resend` (no resend) | all three processes fail, "test timed out (sent 300, received 26)" |
| `test-three-games` | `--nudge 1:300` | no desync logged by the nudged machine and the master, its dump differs at record 300: 3 checks fail |
| `test-three-games` | `auto_aim` added to the hash (what bug D1 is) | the 3-player game fails at tic 1 (the dumps differ, and the slaves do not finish): 12 checks |
| `test-desync` | the log switched off in `NetSyncDiffers` | 4 checks fail (nothing logged, either run) |
| `test-desync` | `-testnudge` does nothing | 6 checks fail (no log, dumps equal) |
| `test-desync` | `TestSyncByte()` returns 0 | the `-testsync` run fails (2 checks); the run without it passes, as it should |
| `test-single` | `--nudge 100` on one of the two games | the dumps differ at record 100 |
| `test-single` | `TestTicEnd()` never quits | 20 checks fail (124, no TEST line, dumps of every tic) |
| `test-udp-unchanged` | `--mutate-wire` | the combinations with the changed master fail |
| `test-udp-unchanged` | the packet-6 version salt always 8 | old/new mixes fail (3 checks) |
| `test-errors` | `NetFailIfRelayFailed()` does nothing | `badcode-format`, `room-no-relay`, `relay-with-np` fail (the game plays single player: exit 999 after 15 s) |
| `test-errors` | `-relay`/`-room` outside `-net` not refused | both new cases fail |
| `test-errors` | the pre-01 game (`build-baseline.sh`), `--only 'badcode-format|room-no-relay|no-such-room|relay-outside-net'` | all four fail |
| `test-relay-lost` | `NetLostCheck()` out of the main loop | the joiner hangs (999): 3 checks fail |
| `test-shareware-gate` | `NetGameAllowedFor()` always 1 | 13 checks fail (nothing is refused) |
| `test-shareware-gate` | it ignores the option | 6 checks fail (nothing is allowed) |

**Corrections to `code-facts.md`** (written into §15): the out-of-sync message is now logged (§2.5); `-t`, `-a`, `-r` and `-h` prefixes swallow unprefixed test options (§15.1); the engine's room limit is 8 though the game allows 16 over UDP; relayed packet 6 is filed under the relaying machine (**bug D1**, below); `gameexit("")` skips the shareware order screens (used for the clean quit).

**Bugs found (not fixed)**

- **D1, game-breaking candidate, reproduces: in games of 3 or more players, a slave stores another slave's announcement (name, weapon order, `aim_mode`, `auto_aim`, `weaponswitch`) against the master** (`src/game.c` `case 6`, `other` instead of `packbuf[1]`). The slaves then disagree with the master about other slaves' `auto_aim` (decides whether a shot is aimed at them), `weaponswitch` (pickups) and weapon order (out of ammo). Found by `-testdump` (the `players` hash differed at tic 1). Needs its own `F` brief; the fix is one line. `-testdump` leaves these fields out until it is fixed.
- D2 (cosmetic): a recording game spawns the SE 27 camera effectors visible, a playback does not (`spawn()`, `src/game.c:4671`).
- For A1 (§15.3): drawing writes `hittype.dispicnum` and the player sprite's `yoffset`; `movefx()` keeps audio state in sprites' `temp_data`; kills are credited to `ps[myconnectindex]`.

**Not done / limits**

- The demo test records an idle player (a headless run has no input), so it exercises little; a later brief should record real play (jfSW's `synth_input.c`).
- Nothing was tried on Windows or macOS; `Makefile.msvc` lists the new objects (untested), the Xcode project does not; **the wasm build (brief 02) must add `netgame.c` and `testhooks.c` to its object list**.
- The startup window's online Host and Join go through the gate (checked by reading, not by a test under `xvfb-run`; jfSW's `test-startwin.sh` is brief 05's).
- A host that vanishes still stalls the other players (they are not told), as in jfSW.
- `-testdump` has no `players` part for `ps[].gm`, `fta` and the like (§15.3, item 6): not observed to differ, not checked.

**Open questions**

- **D13 or D14.** The coordinator's prompt said "D13" for the gate; the README already used D13 for the file names, so it is D14 here. Rename it if D13 was promised elsewhere.
- Should D1 be fixed before A1? Every later 3 or 4 player test with different settings depends on it.
- The engine's `MAXROOMPLAYERS 8` caps relay rooms below Duke's 16 players. A change to the shared fork would have to be agreed with jfSW's; not needed for Duke's shareware (4) or realistic games.
- A rename of the engine's `Module.jfsw*` hooks (§14) is still open.

**Environment note.** While setting up the worktree I ran `git remote set-url` inside the submodules; because worktree submodules share the repository's configuration, the main repository's `remote.origin.url` briefly pointed at vnet's URL. I put it back (`https://github.com/VenKamikaze/jfduke3d-browser.git`, as `FETCH_HEAD` shows) before the first push. Worktrees `wt-d00` and `wt-d02` share that setting: a push from them in between would have failed, nothing else.

### Fix round (review findings)

- **Blocker, the gate could be bypassed with `-g`:** the late gate ran before the `-g` group files were mounted and trusted `gamegrp` or the `DUKESW.BIN` probe, which only ran for an unidentified main GRP, so `-gsub/duke3dshare.grp` (no main GRP) played shareware data as "registered" and was allowed to network. Now the one authoritative check runs after every group file is mounted and asks `NetDataIsShareware()` (`gametype` is shareware, or `DUKESW.BIN` opens from the file system, a ZIP or any mounted group); `gametype` is not changed. New cases in `test-shareware-gate.sh`: shareware by `-g` from a subfolder with no main GRP (UDP host, relay host, relay joiner: refused, and the relay made no room), the same with `-allowsharewarenet` (allowed), and a registered-looking GRP beside the shareware one (refused: the game loads the shareware one). **Proof:** against the previous build the three `-g` cases fail (9 checks: the game waits for players, exit 124); the "both present" case passes on both (it guards the nit below, not the bypass).
- **Early gate nit:** it used the GRP identified before the startup window, so a user whose default was shareware but who picked a registered GRP in the window was refused. It now runs only when no window can change the GRP (`configloaded >= 0`, no `-setup`, no forced setup); the late check decides otherwise. Not testable here (it needs a recognised registered GRP and a person at the window), checked by reading.
- `netgame.h` includes `types.h` for `int32`. `pals_time` is now in the `-testdump` hash (deterministic); `loogiex/loogiey` stay out (`actors.c:2498` reads the local `xdim`); D1's exclusion unchanged.
- `scripts/run-headless.sh --grp none` runs without a GRP in the work directory.
- Limitation stated above (a vanished host mid-game), `bugs.md` and acceptance 6.
- Re-run under `flock`: `test-shareware-gate` (pass; old build fails as above), `test-three-games` (3 and 4 players relay, 2 players UDP: pass with `pals_time` hashed), `test-desync`, `test-single` (pass).
