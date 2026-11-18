# A1: Determinism audit and level-exit tics

## Goal

Look in jfDuke3D for the kinds of original-game desync that the Shadow Warrior port found (jfSW's L20, L25, L27, L28, L29, in `jfsw-browser`'s `bugs.md`), and fix the real ones that a normal multiplayer game reaches. First, find out whether Duke has jfSW's L20: machines playing different numbers of tics after the one that ends a level (jfSW's F3). Then audit the simulation for state and control flow that depend on the machine (sound, screen, view point, menu settings, drawing), and check that the prediction of the local player's moves never touches the real state. Everything found goes into `code-facts.md` §17 with a verdict and how it is known; the rest goes into `bugs.md`.

The user was not available while this was done: the questions the brief left open were decided by the implementer (see the Outcome).

## Scope

1. **This file** (Goal, Scope, Out of scope, Acceptance criteria, Tests, Dependencies, Notes, Outcome).
2. **Level exit, first.** Duke's `moveloop()` plays every tic whose inputs are in; after the tic that sets `MODE_EOL` machines can play different numbers of extra tics and carry different state into the next level. Write a test in jfSW's F3 style (`tests/net/test-level-exit.sh`, in `make test-net`; test-only hooks `-testexit`, `-teststall`, `-testfire`, named as in jfSW) that shows whether it happens, for the relay and plain UDP, 2 and 3 players, co-op (DukeMatch: see the Outcome). Check that every `MODE_EOL` writer runs inside the simulation on every machine. Fix what the test shows, each bug on its own `fix/...` branch from `master`.
3. **The audit** (code reading, backed by tests where practical) of `actors.c`, `sector.c`, `player.c`, `premap.c`, `gamedef.c` and `game.c` for:
   - sound-gated randomness or simulation (jfSW's L27), and simulation state kept in audio structures;
   - local-player state in the simulation (L28, L29): `myconnectindex`, `screenpeek`, `ud.` fields that are set from the menu or per machine, the screen size, kills credited to the local player, `aim_mode` set directly (F4's pattern);
   - CON virtual machine commands that read machine-local state;
   - prediction purity: `fakedomovethings()` must never change the real simulation (a test-only check in a network game);
   - drawing code that writes what the simulation reads: only **catalogued** here, for brief 04.
4. **Fixes** by the project's bug policy (`README.md`): a reproducible desync or game-breaking bug that a normal game reaches is fixed on a `fix/...` branch from `master` (`55c5f95`, upstream), minimal and upstream-friendly, line endings kept, one branch per independent bug, the commit ending with only `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, proved to cherry-pick onto `master`, pushed, and merged `--no-ff` into the browser branch. Every fix has a test that fails without it. Budget: at most three fixes; the rest is recorded in `bugs.md` with a reason and a recommendation.
5. **Docs:** `bugs.md` (D5 to D14 only), `code-facts.md` §17, `building.md`, and this brief's row of the status table in `README.md`.

## Out of scope

- Fixing anything that drawing writes (brief 04 decides, when a hidden browser tab skips drawing).
- DukeMatch level ends in the test (they wait for a key in `dobonus`, see the Outcome).
- The data check between machines (brief 05b), the lag work (04b), vnet, the engine forks.
- `PROMPT.md`, other briefs' rows of `README.md`, `bugs.md` numbers D15 and up.
- Sending anything upstream.

## Acceptance criteria

1. A test that shows whether the level exit leaves the machines at different tics, run natively over the relay and over plain UDP with 2 and 3 players, passing on the fixed game and failing, for each fix, on a build without it.
2. Every `MODE_EOL` writer is accounted for (inside the simulation on every machine, or why not).
3. §17 lists every finding with file and line, a verdict (real desync, harmless with the reason, needs brief 04) and how it is known.
4. Prediction purity is checked by a test in a network game, and the check is shown to fail when the prediction writes real state.
5. Each fix branch has one commit for one bug, applies to `master` unchanged, keeps line endings, has the trailer rule above, and is pushed; the browser branch merges each with `--no-ff`.
6. `make test-net` passes whole.

## Tests

- `tests/net/test-level-exit.sh [--game FILE] [--runs N] [--only NAME]` (new; `relay-slave`, `relay-master`, `relay-3`, `udp-slave`, `udp-master`, `udp-3`): the level ends at tic 200, a machine stops for 1.5 s at tic 190, every player holds fire and walks about; every game must exit, play exactly 200 tics of the first level, and agree with the others tic by tic (dumps) and field by field (state dumps) in the next level.
- `tests/net/test-predict-pure.sh [--game FILE]` (new): `-testpredict` on every machine of a 3-player relay game and a 2-player UDP game.
- Mutation: each fix removed in turn, and the prediction made to write real state.
- Everything else of `make test-net`.

## Dependencies

Brief 01 (`-testdump`, `-teststate`, the relay and the test library) and F-D1 (the announced settings are in the hash).

## Notes

See the Outcome and `code-facts.md` §17.

## Outcome

**Status: landed on its branch** (18 Nov 2026), not merged into `claude`. Jfduke3d has jfSW's L20 **and a worse bug next to it**: the game hangs at the end of a level when a slave's inputs reach the master late. Two game-breaking bugs fixed on their own branches from `master`; nine more findings recorded; prediction is pure; no Duke equivalent of L25, L27, L28 or L29 desyncs.

### Commits

| Branch | Commits |
|---|---|
| `fix/level-exit-tics` (from `master` `55c5f95`, pushed) | `e79140d` Stop running tics once one has ended the level (D5) |
| `fix/level-exit-forward` (from `master`, pushed) | `27e9aef` The master sends the slaves the tics it has played before it leaves the level (D6) |
| `browser/A1-determinism-audit` (from `claude` `605a877`, pushed) | `e6b6d56` merge of D5's fix, `ad4f565` merge of D6's fix (`--no-ff`), `a4d8f46` test hooks, `test-level-exit.sh`, `26876ae` `-testpredict`, `test-predict-pure.sh`, `--nosound`, docs, `9eba8dd` the `-testpredict` hash leaves out the audio thread's writes, and the docs commit that holds this Outcome |

Both fix commits end with only `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, keep `src/game.c` and `src/funct.h` LF as they were (`file` before and after), and **cherry-pick onto upstream `jonof/jfduke3d` `master` (`55c5f95`, a fresh clone, 18 Nov 2026) in either order without a conflict**. Upstream has nothing newer; none of its 15 pull requests (`refs/pull/*/head`, `git diff master...pr` on `game.c`, `player.c`, `sector.c`) mentions `moveloop`, `MODE_EOL`, `movefifosendplc`, `domovethings`, `ready2send` or `faketimerhandler` in a changed line.

### The level exit: verdict and fixes

- **D5 (jfSW's L20) is in Duke.** After the tic that sets `MODE_EOL`, `moveloop()` goes on with every tic that has inputs. With the master stopped for 1.5 s ten tics before the exit, the unfixed game played 214 to 215 tics of the first level on the master and 211 to 212 on the slave, carried 285 against 286 chaingun rounds into the next level, and logged `GAME OUT OF SYNC` from its tic 1 (3 games of 3, relay; 216 against 212 over UDP). Fix: `if (ps[myconnectindex].gm&MODE_EOL) break;` after `domovethings()`.
- **D6 is new (jfSW has no such bug).** The master plays a tic as soon as every input is in and forwards it at its next timer tick; when a slave's inputs are late, it plays the last tic of the level first, the main loop then stops its sending (`ready2send = 0`), and the slaves never get the tic that ends the level: **everyone hangs**. No test hook is needed: unfixed, with 60 ms latency each way 2 of 3 games hung at the first level end, at 100 ms 1 of 3, at 30 ms 0 of 3; with the joiner's datagrams 200 ms late 4 of 7. Fix: the master's loop is `sendmasterpackets(upto)` and the `MODE_EOL` branch calls it for the tics played.
- **All four live `MODE_EOL` writers run inside the simulation on every machine** (`code-facts.md` §17.1); the cheats are single player; nothing sets it outside a tic in a network game.
- **Why two branches:** each can fail alone. Without D6's fix the slave-stall scenario hangs even with D5's; without D5's the exit works and the machines play different numbers of tics.

### Test and mutation evidence

`tests/net/test-level-exit.sh` (in `make test-net`): six scenarios, 2 and 3 players, relay and plain UDP, a machine stopped for 1.5 s at tic 190, the level ending at tic 200, every player firing a chaingun and walking about, 300 tics of the next level (`code-facts.md` §17.5 for the hooks). Per scenario: every game exits 0, plays exactly 200 tics of the first level, logs no desync; the dumps are byte for byte the same (500 records); the state dumps agree field for field at the next level's start and at its tic 300; the ammo was spent before and after the exit; the master had the inputs of at least 2 more tics when it left (the case the unfixed game got wrong).

| Build | Result |
|---|---|
| both fixes | all six scenarios pass (the whole of `make test-net`, and 9 more games: 3 runs each of `relay-master`, `udp-slave` and `relay-3`, 157 checks, none failed) |
| without D5's fix (`break` removed) | `relay-master`, `udp-master`, `udp-slave` fail, 8 to 9 failed checks each: 208 against 202 tics, 211 against 204, 212 against 208, different dumps and states; `udp-master` 3 runs of 3: 211 against 204, 211 against 204, 209 against 204 |
| without D6's fix (the call before `ready2send = 0` removed) | `relay-slave` and `udp-slave` fail: both games hang until the 60 s limit (exit 124), 200 and 192 records; `udp-slave` 3 runs of 3 hang |
| a prediction that does not restore the player sprite's `cstat` (scratch build) | `test-predict-pure.sh` fails on every machine: 85 to 95 of about 450 predicted moves "changed the simulation: sprite", and the games desync |

### The audit (details in `code-facts.md` §17)

| Finding | Verdict |
|---|---|
| level exit: extra tics (D5), hang (D6) | **real, fixed** |
| use key at a mirror with a sound: early `return` depends on `screenpeek` and on audio state (`sector.c:3008`) | **rare**, D7 open |
| gibs and glass get the local player's sprite as owner (D8) | harmless (nothing reads it), open |
| a multiplayer load reads the machine's own save file (D9) | rare, not planned |
| CON `ifnosounds` (D10) | harmless in the stock CON (unused) |
| input packets carry no tic number; `clearfifo()` precedes the barrier (D11) | rare, not reproduced in about 50 level exits |
| `scream_voice` and `orotscrnang` in the hash (D12) | harmless, out of the hash |
| sound-gated randomness or simulation (L27) | **none in Duke**: every `issoundplaying`/`isspritemakingsound` site gates only a sound call (checked one by one); `movefx()` keeps audio state in `temp_data`, which only it reads; the audio callback writes it from the audio thread |
| local-player state (L28/L29): `myconnectindex`, `screenpeek`, `ud.` fields, screen size, kills, `aim_mode` | **harmless**, all 14 sites explained; `aim_mode` is in the input (bit 23), F4's bug does not exist; `ud.lockout` changes only wall pictures; `loogie` is `TRAND % xdim` with the same number of calls |
| CON VM commands reading local state | only `ifnosounds` (D10) and the display-only `quote` |
| prediction purity | **pure**: 0 changes in about 450 predicted moves on each of 5 machines, three runs |
| a player without sound plays the same game | `test-three-games.sh --nosound 1 --fire`: 600 tics, 3 players, dumps identical |

### Catalogued for brief 04 (not fixed here)

None of these is read by simulation logic, so a hidden tab that skips drawing does not desync the game, but they change the state hash: `hittype.dispicnum`, `sprite.yoffset` of a player's sprite (both out of the hash), the viewscreen sprites' `hittype.temp_data[0]` and `owner` written by `animatecamsprite()` (**still in the hash**: a player near a security monitor would show a difference between a drawing and a non-drawing machine), `ps[].orotscrnang`, `ps[].visibility`. The wasm build is software-rendered, so `orotscrnang` does not apply there.

### Test results

`make test-net` (from the branch, under `flock`, `GAME_RUNS=1`): **all 15 invocations pass, 467 `ok` lines, 0 `FAIL`, about 14 minutes** (the 12 of F-D1's run, plus `test-level-exit.sh`, `test-predict-pure.sh` and `test-three-games.sh --relay --nosound 1 --fire --tics 600`).

| Test | Result |
|---|---|
| `test-level-exit.sh` (all six scenarios) | passes, once in `make test-net` and once before it |
| `test-level-exit.sh --runs 3 --only relay-master --only udp-slave --only relay-3` | 9 games, 157 `ok`, 0 `FAIL` |
| `test-predict-pure.sh` | passes 5 times (in `make test-net` and 4 more): 453 to 565 predicted moves on each of 5 machines, 0 changed the simulation. **The first run found 1 "change" on two machines**: the audio thread's callback (`sounds.c:657`) writing the ambient sound sprites' `hittype` in the middle of a prediction; the check leaves those entries out now (`code-facts.md` §17.2, item 8) |
| `test-three-games.sh --relay --nosound 1 --fire --tics 600` | passes (player 1 with `-ns`, the others with sound; the dump of 600 tics identical) |
| the F-D1 set: `test-three-games.sh` (relay 3, 2 and 4 players, relay with impairment, UDP), `test-desync.sh`, `test-player-announce.sh`, `test-single.sh`, `test-udp-unchanged.sh`, `test-errors.sh`, `test-relay-lost.sh`, `test-shareware-gate.sh` | all pass; the dumps are identical with the two fields (`scream_voice`, `orotscrnang`) left out of the hash |

### Open

- D7 (not reproduced; recommendation in `bugs.md`), D8 to D11.
- **DukeMatch is not tested** at a level end: `dobonus()` waits for a key on every machine. Both fixes act before it and do not depend on the game mode. **Peer-to-peer** mode is not tested (D6 cannot happen there: everyone sends its own inputs).
- The wasm build was not rebuilt here (no emsdk in this environment): the changes to `game.c` are plain C, and `-teststall` waits with `emscripten_sleep` there as jfSW's does.
- The `-testquit` hook now sends the slaves the last tics before it leaves; that ends the old "one tic short" quit race noted by F-D1.

### Decisions taken without the user

1. **Two fix branches**, not one: the two bugs fail independently (above). A third candidate (D7) was not fixed: it is rare, nothing reproduces a difference, and the fix changes single player when the sound is still playing; recommendation in `bugs.md`.
2. **The exit hook goes through the game's own writer** (`timebeforeexit = 2` on `connecthead`, which `processinput` counts down to `player.c:2516`) rather than writing `gm`, so that the real code runs inside the tic. Only one player is given it: every player's would count the level number up once per player.
3. **The hooks are named as in jfSW** (`-testexit`, `-teststall`, `-testfire`) but differ where Duke does: `-testfire` also gives the players weapons (a game started with `-v1 -l1` gives co-op players none) and walks them about, so a stale or missing input changes where they go; a stall must be placed before the exit tic in Duke because Duke's tic loop does not make inputs in the middle of a tic; the slave-stall scenario is Duke's natural way to make the master hold many inputs.
4. **`scream_voice` and `orotscrnang` were taken out of the state hash**, and the ambient sound sprites' `hittype` out of the prediction check, on the evidence of the code (audio and drawing write them); a hash change in a test hook, not a change to the game.
5. **D11 is recorded, not fixed**: a cure (dropping input packets from a peer whose `playerreadyflag` is behind ours) is a change to the netcode for a hazard that never appeared in about 50 level exits.
6. **Bug numbers:** D5 to D12 of the D5 to D14 allowed; D13 and D14 are free.

### Play-test steps for the user (Arch Linux)

```bash
sudo pacman -S --needed base-devel git go sdl2 libvorbis alsa-lib gtk3 iproute2
git fetch origin && git checkout browser/A1-determinism-audit && git submodule update --init
scripts/fetch-test-data.sh && make -j4
(cd ext/vnet/relay && go build -o /tmp/vnet-relay ./cmd/vnet-relay)
/tmp/vnet-relay -udp 127.0.0.1:7777 -http "" -v                 # terminal 1
sudo tc qdisc add dev lo root netem delay 30ms                  # each datagram crosses the loopback twice (player, relay, player): 60 ms each way; remove: sudo tc qdisc del dev lo root
mkdir -p /tmp/a1h /tmp/a1j
(cd /tmp/a1h && ~/path/to/jfduke3d-browser/duke3d -allowsharewarenet -net -relay 127.0.0.1:7777 -host-room 2 -- -v1 -l1 -c2 -testexit200)   # terminal 2: prints the room code
(cd /tmp/a1j && ~/path/to/jfduke3d-browser/duke3d -allowsharewarenet -net -relay 127.0.0.1:7777 -room CODE -- -v1 -l1 -c2 -testexit200)      # terminal 3
```

Both games end the first level at tic 200 (7 seconds) and go on into the second. To see the bug, take the two fixes out of a scratch copy of the tree (delete the line `if( ps[myconnectindex].gm&MODE_EOL ) break;` in `moveloop()` and the two lines `if (numplayers > 1 && networkmode == 0 && myconnectindex == connecthead) sendmasterpackets(movefifoplc);` in the main loop's `MODE_EOL` branch, in `src/game.c`; `make`) and run the same two commands a few times: in most tries both windows stop at the end of the first level and stay stopped (the host's log ends at `TEST: left the level after tic 200`). The tests on your machine: `tests/net/test-level-exit.sh`, `tests/net/test-predict-pure.sh`, `make test-net`.
