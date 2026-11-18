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

With the shareware GRP (`VOLUMEONE`) network games are refused by default, with a clear message, unless allowed: `[Comm Setup] AllowSharewareNetGames = 1` in `duke3d.cfg` (default 0, read and written by `config.c` like the other keys) or `-allowsharewarenet` on the command line (a test and page switch, not written to the file; it must come **before** `-net`, because mmulti reads what follows `-net` up to `--`). Registered data (any GRP that is not the shareware one) always allows network games. It applies to plain UDP and relay games alike, and to the startup window's Join and Host. The refusal happens before anything is opened when the GRP is already known (so no relay room is made), and again after the data is loaded. `NetGameAllowed()` is the one function a later entry point (the menu or the console's Host/Join, brief 05) must ask. The reason is the shareware licence's `[3][D]` (see `00-setup.md`, Outcome, "Licence"): online multiplayer services need 3D Realms' written permission, so shareware netplay is meant only for LAN deployments. The browser's `config.js` equivalent and hiding the menu and console entries are later briefs; the game-side switch is designed so the page can pass `-allowsharewarenet`.

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
6. A bad relay argument, an unreachable relay, a missing or full room, a host that never answers or leaves, and a relay session lost in a game each end with a message and exit status 1 within a bounded time.
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

(To be filled in.)
