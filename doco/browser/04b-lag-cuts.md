# 04b: Netcode lag cuts

## Goal

Shorten the time between a player's input and the tic that uses it, in every network game (browser and native, host and guest), by changing only *when* packets are sent, never what they contain. Prediction (`fakedomovethings()`) already makes a player's own movement and turning feel local. Shooting, using, opening, inventory and weapon changes are not predicted, so they wait for the full lockstep round trip. That round trip is what this brief shortens.

This is jfSW's brief 04b ([`doco/browser/04b-lag-cuts.md`](https://github.com/VenKamikaze/jfsw-browser/blob/claude/doco/browser/04b-lag-cuts.md) in `jfsw-browser`, Outcome included: it is the template), redone for Duke's netcode, which lives in `src/game.c` and has `sendmasterpackets()` already (A1's D6).

## Read first

- [`README.md`](README.md): D4, D5, D14, Q5, "Working across repos", "Bugs found in the original game" (numbers for new bugs: **D19 and up**).
- [`PROMPT.md`](PROMPT.md) §0 and §7.
- [`code-facts.md`](code-facts.md): §2 (the netcode: `getpackets()`, `faketimerhandler()`, `moveloop()`), §15 (the test hooks), §17.1 (the level exit: D5 and D6), §20 (04), §20.6 (D11).
- The Outcomes of [01](01-native-relay.md), [A1](A1-determinism-audit.md) (D5: no tics after the exit tic; D6: the master sends what it has played before it leaves) and [04](04-browser-netplay.md), including its fix round (D11 and `waitingfornewlevel`; `test-save.sh`).
- [`bugs.md`](bugs.md), [`building.md`](building.md).
- jfSW's brief and code (`src/net.c` `SendInputNow()`, `MasterForward()`; `src/sync.c` `-testlag`; `tests/web/netplay.js` scenarios `lag`, `tic1`, `lag-matrix`).
- The code here: `src/game.c` (`getpackets()`, `faketimerhandler()`, `sendmasterpackets()`, `moveloop()`, the main loop's `MODE_EOL` branch, `movesperpacket`, the lag correction: `myminlag`, `otherminlag`, `bufferjitter`, `TIMERUPDATESIZ`), `src/premap.c` (`waitforeverybody()`, `clearfifo()`), `src/netgame.c` (`HiddenNetPass()`), `src/testhooks.c`, `jfbuild/src/mmulti.c` (`sendpacket`, `dosendpackets`, PAKRATE, `unsent[]`, `mmulti_vnet_flush`, the two test hooks).

## Claims checked against Duke's code (jfSW's findings, one by one)

1. **The input waits for the send window.** Same here. `faketimerhandler()` calls `getpackets()` (`src/game.c:837`) before `getinput()` makes the input; `getpacket()` calls `dosendpackets()` for every peer first (`jfbuild/src/mmulti.c:1184`); `dosendpackets()` returns inside the 25 ms window (`PAKRATE 40`, `:1127`) and otherwise sends a datagram with the acknowledgements and resends. The input's own `sendpacket()` then finds the window used. The input leaves at the next `dosendpackets()` after the window. The jfbuild fork is shared, so the code is identical to jfSW's.
2. **The master forwards a tic only at its own timer tick.** Same here, with a difference in shape: Duke's loop is already a function, `sendmasterpackets(int upto)` (A1's D6), called from the end of `faketimerhandler()` with `0x7fffffff`, from the main loop's `MODE_EOL` branch with `movefifoplc`, and from `-testquit`'s last loop. `getpackets()` never calls it.
3. **`packbuf` is shared between receive and send.** Yes: `getpackets()` reads into the global `packbuf` (`getpacket(&other, packbuf)`), and `sendmasterpackets()` builds in `packbuf`. A forward from inside the receive loop would overwrite the packet being read (its sync bytes are read after the input). So the new call goes **after** the receive loop. (Nested `getpackets()` calls exist already: packets 5, 8 and 126 start a level or load a game from inside the loop, and those read what they need from `packbuf` first.)
4. **`HiddenNetPass()`'s own flush** (`src/netgame.c`) and **its `checksync()`**: to be checked by mutation after step 2 (the flush) and kept (the sync check).
5. **jfSW's tic-1 cause (ceiling/floor override markers) does not exist in Duke.** 04's audit found no drawing write that the simulation reads. Whether Duke still differs at tic 1 under an uneven first frame is measured, not assumed.
6. **Duke-only hazards that jfSW did not have:** `movesperpacket` 1, 2 and 4 (`-f2`, `-f4`); the level-change rules (D5, D6, D11 and `waitingfornewlevel`); multiplayer saves (`saveplayer()` and `loadplayer()` run barriers inside `domovethings()`).

## In scope

### 1. Measure first (test-only)

- `-testlag<name>` (new, in `src/testhooks.c`): one record per game tic, from this machine's own clock (`CLOCK_MONOTONIC`), as jfSW's: input made, every input here, tic ran, how long the packet carrying it waited in mmulti (`sendpacket()` to a datagram leaving), how long the master held a complete tic before queueing the combined packet, `otherminlag`, `bufferjitter`, the sum of the clock corrections; and at `-testquit` the datagram count per peer (new data, paced, redundant). Two observation-only hooks already exist in the jfbuild fork (`mmulti_test_queuehook`, `mmulti_test_sendhook`, NULL unless set): **no fork change**.
- Nothing goes on the wire and nothing changes without the argument. Prefix check: the existing game options are `-testquit`, `-testsync`, `-testnudge`, `-testdump`, `-teststate`, `-testexit`, `-teststall`, `-testpredict`, `-testmenu`, `-testfire`, `-testsave`, `-testlate`, `-testdrawcheck`, `-testnodraw`, `-testcam`, `-testmirror`, `-testarm`, `-testloosecon`. They are matched by `Bstrncasecmp(c, "testxxx", n)` in `game.c`'s option scan in order; none is a prefix of `testlag` or of `testslowstart` (nor the reverse); `-testlate` and `-testlag` share only `-testla`. In Duke the `-net` sub-options are skipped by the game's own parser (`--` ends them), so there is no jfSW L1 skip list to extend.
- A baseline, **before any cut**: median and p95 input-to-tic delay, master and slave, for browser+browser, browser host+native, native host+browser, native+native, each unimpaired and with 30 ms added each way (`netplay.js lag-matrix`), with the datagram counts per peer.

### 2. Send each input when it is made

- `SendInputNow()` in `src/game.c` calls `mmulti_vnet_flush()` right after `faketimerhandler()` hands this machine's input (a slave's packet 1, or peer-to-peer packets 16/17) or the master's combined packet 0 to mmulti. jfSW's choice: no engine change, and PAKRATE still paces datagrams that carry only acknowledgements and resends. It applies to plain-UDP `-net` games as well (the code is shared; `mmulti_vnet_flush()` works on any peer).
- **Datagram rate bounded.** Reported per peer before and after; at most about twice the old rate is fine.
- **`HiddenNetPass()`'s flush**: removed if the hidden scenarios pass unchanged without it (mutation table). Its `checksync()` stays.

### 3. The master forwards a tic as soon as it is complete

- `getpackets()` ends with `sendmasterpackets(0x7fffffff)` for the master in master/slave mode, after the receive loop, when `ready2send` is set (the same condition under which `faketimerhandler()` sends). `sendmasterpackets()` itself flushes once if it sent anything.
- **The same inputs in the same order of tics.** The function is the same loop and sends tic `movefifosendplc` only when every live player has an input for it; it only runs at more moments. What follows the timing, as it always did: the lag-correction bytes of every 32nd tic (`TIMERUPDATESIZ`: each slave's `myminlag` measured so far, sent and reset when that tic is sent) and which of the master's sync bytes ride in which packet (all the pending ones, appended to the next packet sent). Neither is read as game input.
- **`movesperpacket` 1, 2, 4** (`-f2`, `-f4`): `sendmasterpackets()` sends a batch of `movesperpacket` tics as one packet and advances `movefifosendplc` by that; a slave's packet 1 also appends `movesperpacket` inputs at once, and the master's own copies are made by the intermediate `faketimerhandler()` calls. The new call site never sends a partial batch because it calls the same function with no `upto`; a test runs each step at `-f2` and `-f4`.
- **The level-change rules.** (D5) No new play after the exit tic: the forward is gated on `ready2send`, which the main loop clears at `MODE_EOL` before anything else can forward. (D6) The `MODE_EOL` branch still calls `sendmasterpackets(movefifoplc)` first. (D11, `waitingfornewlevel`) A forward from `getpackets()` can only send tics for which the master's own input exists, and **never from inside `waitforeverybody()`** (a counter `inbarrier`; added in the fix round: `ready2send` is still 1 in `newgame()`'s first barrier and in `saveplayer()`'s, and the master's queue is full there, so a nested `getpackets()` would forward tics after the master's ready packet, which a packet 0 without a tic number and without the D11 guard cannot tell from the new level's). Before 04b nothing was forwarded in any barrier, and now nothing is again.

### 4. The tic-1 check

- A test-only `-testslowstart<ms>` (per machine, inert without it): the machine waits `<ms>` ms when its level has started and before its first frame, with its clock running. The master gets it, so its first frame comes late while the guests draw many; the dumps and the state dumps (`-teststate`, tics 1 to 3, with the number of frames drawn before tic 1) must agree in all four pairings. If they differ, investigate with `-teststate` as jfSW did and report.

## Out of scope

- Changing packet contents; prediction (`fakedomovethings()`); 05's lobby and UI; engine changes. If one proves needed it goes on a fork branch and both games' `make test` must pass before the pin moves. (None is expected.)
- The lag-correction algorithm (`bufferjitter`): if it is the largest remaining cost, report it with numbers, don't change it.
- vnet, the relay, peer-to-peer over the relay (D5).

## Acceptance criteria

1. **A measured cut.** Median and p95 input-to-tic delay for master and slave, before and after, in each of the four pairings, unimpaired and with 30 ms each way; the cut per step (step 2 alone, then 2 and 3); the datagram count per peer before and after.
2. **No change to what is played.** Every 04 `netplay.js` scenario passes with identical dumps; `test-level-exit.sh`, `test-save.sh`, the hidden scenarios and strict `determinism.js` pass. Each step at `movesperpacket` 1 and at 2 or 4.
3. **The tic-1 check** passes in the four pairings.
4. **Mutations**: each new test or scenario fails without its feature (the `lag` bounds with steps 2 and 3 reverted; `tic1` and its measurement; the receive buffer used for the send; the hidden pass's flush).
5. **No regressions**: `make test`, `make test-net`, `make test-web` (known caveats reported).
6. **Docs**: this Outcome, `code-facts.md` §21, `bugs.md`, `building.md`, this brief's row in the README only. `PROMPT.md` is not edited.

## Tests

- `netplay.js`: `lag` (checked bounds on the mechanisms: packet wait in mmulti, the master's forwarding wait, the datagram rate, the lag correction not oscillating; the delay itself only where it is steady), `tic1`, `lag-matrix` (a report, by name), and a `lag-batch` run at `-f2`/`-f4` (agreement and the bounds). Existing scenarios unchanged.
- Native: `-f2` and `-f4` network games in `tests/net/` if cheap (agreement over a relay).
- Builds of the variants for the table: "before" (measurement only), "step 2 only", "steps 2 and 3", each built into its own directory and run with `NETPLAY_GAME` / `WASM_DIR`.
- Mutations as in criterion 4, each applied, rebuilt, run, reverted, listed in the Outcome.
- Regression as in criterion 5.

## Dependencies

04 (merged: `-testdump`, `netplay.js`, `mmulti_vnet_flush()`, the hidden pass), A1 (D5, D6, `sendmasterpackets()`), the fork's hooks (jfbuild `5950d14` has `mmulti_test_*hook`). Brief 05 comes after.

## Notes

- Repos touched: jfduke3d-browser only (jfbuild stays at `5950d14`, no fork branch). Branch `browser/04b-lag-cuts` from `origin/claude` `6d8302e`.
- Ports and loads as 04: browser tests 48400 to 48499, native network tests 47400 and up, one test at a time under `flock /tmp/jfd-heavy-tests.lock`, `EMSDK_DIR=~/.cache/jfsw-browser/emsdk`; report the load with every rate or delay. Headless Chromium here is software-rendered on 4 shared cores, so browser delays are noisy.
- Line endings: `menues.c`, `player.c`, `sector.c`, `premap.c` are CRLF; this brief is not expected to touch them (the CR count is checked before each commit).
- Commit trailers on browser commits: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01Cx2moAtxK78zTspjE2Gxak`.

## Outcome

Status: **review** (branch `browser/04b-lag-cuts` in jfduke3d-browser, from `claude` `6d8302e`). **No fork change**: jfbuild stays at `5950d14` (it already has the two observation hooks `mmulti_test_queuehook` and `mmulti_test_sendhook` and `mmulti_vnet_flush()`), jfaudiolib and jfmact are untouched, so jfSW's `make test` was not affected and was not run. **No bug of the original game was found**: no `fix/` branch, nothing new in `bugs.md` apart from a note (below). Nothing was merged, no pull request was opened, `claude` and `master` were not touched. Not tested: a person playing, a tab that is really hidden (Playwright cannot hide one; the imitation is as in 04), Firefox and Safari, a real network, a real GPU, a registered GRP, DukeMatch, Windows (the `-testlag` timer has a `QueryPerformanceCounter` branch that was not built) and macOS.

**What landed** (commits on the branch, in order: the brief, `9bc6bdd` step 1, `93f94cb` step 2, `c2414ea` step 3, then the tests, the hidden pass and the docs)

- *Step 1, measurement (test-only).* `-testlag<name>` (`src/testhooks.c`): 36 bytes per game tic from this machine's own clock: input made, every input here, tic ran, how long the packet carrying the tic's data waited in mmulti between `sendpacket()` and a datagram leaving, how long the master held a complete tic before queueing the combined packet, `otherminlag`, `bufferjitter`, the clock corrections so far; at `-testquit` one line per peer with the datagram counts (new data, paced, redundant). Written 16 tics late, because the datagram, and on the master the combined packet, often leaves after the tic has run (a record written at once would say "unknown" for exactly what it measures). `-testslowstart<ms>` (the `tic1` scenario): the machine waits when its level has started, before its first frame, with its clock running; a `-testdump` machine logs `TEST: frames drawn before tic 1 of level N: F`. Both inert without their argument, nothing on the wire. Prefix check: `-testlag` and `-testslowstart` are neither a prefix of nor prefixed by `-testquit`, `-testsync`, `-testnudge`, `-testdump`, `-teststate`, `-testexit`, `-teststall`, `-testpredict`, `-testmenu`, `-testfire`, `-testsave`, `-testlate` (shares only `-testla`), `-testdrawcheck`, `-testnodraw`, `-testcam`, `-testmirror`, `-testarm`, `-testloosecon`; the game's own parser skips the `-net` arguments, so there is no L1 skip list here.
- *Step 2, every input goes on the wire when it is made.* `SendInputNow()` (`src/game.c:457`) calls `mmulti_vnet_flush()` right after `faketimerhandler()` hands mmulti a slave's packet 1 or the peer-to-peer packets 16 and 17, and once at the end of `sendmasterpackets()` when it queued a tic. jfSW's choice, **no engine change** (the alternative, a `sendpacket()` that bypasses PAKRATE for new data, needs one); the 25 ms window still paces datagrams that carry only acknowledgements and resends. It applies to every network game, relay or plain UDP, master/slave or peer-to-peer (the code is shared and the bytes sent are the same).
- *Step 3, the master forwards a tic as soon as it is complete.* `getpackets()` ends, **after** its receive loop, with `sendmasterpackets(0x7fffffff)` for the master in master/slave mode when `ready2send` is set (`src/game.c:822`). Duke already had the loop as a function (A1's D6), so nothing was copied from jfSW's `MasterForward()`. `packbuf` is shared between receive and send exactly as in jfSW (the mutation below shows what a send inside the receive loop does).
- *The hidden pass's own flush is gone* (`HiddenNetPass()`, `src/netgame.c`): with step 2 every tab flushes each input as it makes it, and the four hidden scenarios pass without it (mutation table). **Its `checksync()` stays.**
- *Tests and docs.* `netplay.js`: `lag`, `lag-batch`, `tic1` in the full run, `lag-matrix` by name only; `test-three-games.sh` and `test-level-exit.sh` take `--mpp 2|4`, and three lines in `make test-net` run `-f2`/`-f4`. `code-facts.md` §21, `building.md`, the README row. `PROMPT.md` is not edited.

**Decisions** (the conservative option, closest to jfSW)

1. Flush with `mmulti_vnet_flush()` (jfSW's choice), not a change in mmulti's pacing.
2. The new call site calls Duke's `sendmasterpackets()`, with the gate that `faketimerhandler()` itself has (`ready2send`) and master/slave mode only; `sendmasterpackets()` flushes once per call that sent something, not once per tic.
3. Peer-to-peer packets (`networkmode == 1`, 2 players, plain UDP) are flushed too; the suite has no peer-to-peer test (`-np`); a two-player game was run by hand, see Tests.
4. `-testslowstart` is called from `resettimevars()` (`src/premap.c`, CRLF kept), which `enterlevel()` and `loadplayer()` both end with; a loaded game would wait too if the argument is given.
5. The frames drawn before tic 1 go in the log, not in the `-teststate` dump header: `test-level-exit.sh` compares the blocks of the dumps whole (the first version put them in the header and failed that test).
6. `lag`'s one end-to-end bound (two native games, 30 ms each way, the slave's median) is 75 ms (jfSW's is 85): with both steps 67.0 to 67.1 ms in three runs, with step 2 only 81 to 100, before 110 to 134. The other bounds are on the mechanisms (packet wait under 5 ms, forwarding wait under 2 ms at the median and 8 ms at p95, at most 80 datagrams a second per peer, the lag correction does not oscillate).
7. `HiddenNetPass()`'s flush was removed (the brief said "if redundant").
8. The redundant acknowledgement datagrams that step 2 adds (below) are reported, not removed: that is a change in `mmulti.c`'s pacing.

**Why the bytes that follow the master's timing do not matter.** Step 3 sends the same packets in the same order, only sooner. The inputs in them are the same; what depends on *when* the master sends is (a) every 32nd tic's lag-correction bytes (each slave's `myminlag` measured so far, reset when sent) and (b) which of the master's pending sync bytes go in which packet (all that are pending, appended to the next packet sent). Both followed the master's timing before (it measured at its own inputs and sent at its own tick), neither is a game input, and the sync bytes are matched by their order, not by the packet they ride in. Every `-testdump` of every scenario is identical on all machines (below).

**Level-change rules** (checked by reading, then by the tests below; corrected in the fix round). D5, no tic after the exit tic: the new call is gated on `ready2send`, which the main loop clears at `MODE_EOL` before anything else can send, and nothing between the tic that sets `MODE_EOL` and that branch calls `getpackets()`. D6: the `MODE_EOL` branch still sends what has been played first (`sendmasterpackets(movefifoplc)`). D11 and `waitingfornewlevel`: the new call also needs **`!inbarrier`** (`waitforeverybody()` counts itself in and out): the first version relied on the master's empty queue after `clearfifo()`, which holds for `enterlevel()`'s and `loadplayer()`'s barriers but not for `newgame()`'s first barrier or `saveplayer()`'s (`ready2send` is 1 and the queue is full), where it did forward tics after the master's ready packet and, in `saveplayer()`'s, claimed "the same tics, sooner". With `inbarrier` no barrier forwards anything, as before 04b. `movesperpacket`: the call is the same loop and sends a batch of `movesperpacket` tics as one packet (`movefifosendplc += movesperpacket`), so a batch is never sent in part; every step was run at `-f2` and `-f4`.

**Results: input to tic** (median / p95 ms of each game from tic 200 to 1,200, two `lag-matrix` runs of each build one after another and one at a time; headless Chromium, software-rendered, 4 shared cores, load average 2.6 to 5.7; "before" is `claude` plus the measurement hooks, "step 2 only" has no call in `getpackets()`; first-named machine hosts and is the master; the game's tic is 33.3 ms, so most figures sit near multiples of it)

| game (first hosts) | machine | before | step 2 only | steps 2 and 3 |
|---|---|---|---|---|
| browsers | master | 103.3 / 118.1, 67.0 / 79.1 | 67.3 / 82.7, 67.3 / 79.3 | 100.3 / 112.1, 69.1 / 84.0 |
| browsers | slave | 136.4 / 151.2, 135.5 / 169.7 | 108.8 / 141.7, 134.1 / 144.4 | 104.1 / 141.6, 100.5 / 126.0 |
| browsers-30ms | master | 133.2 / 142.8, 102.1 / 139.1 | 159.5 / 182.3, 97.4 / 112.4 | 102.4 / 117.2, 101.3 / 116.0 |
| browsers-30ms | slave | 201.5 / 215.0, 234.2 / 248.5 | 169.2 / 183.5, 200.0 / 213.6 | 169.8 / 183.9, 180.9 / 214.0 |
| browser-host | master | 101.1 / 133.9, 108.6 / 148.7 | 92.5 / 119.2, 70.2 / 107.7 | 67.6 / 85.3, 101.0 / 132.0 |
| browser-host | slave | 155.9 / 169.6, 166.8 / 201.1 | 101.6 / 167.7, 101.3 / 166.9 | 100.9 / 134.7, 101.0 / 135.6 |
| browser-host-30ms | master | 137.3 / 182.5, 169.2 / 188.1 | 168.0 / 227.2, 140.9 / 179.8 | 133.6 / 153.8, 170.2 / 208.4 |
| browser-host-30ms | slave | 200.8 / 237.6, 200.4 / 201.7 | 200.7 / 265.9, 167.9 / 202.2 | 167.7 / 201.3, 167.3 / 201.0 |
| native-host | master | 100.3 / 102.0, 67.0 / 68.4 | 67.2 / 68.6, 67.2 / 68.4 | 100.4 / 101.7, 67.3 / 101.0 |
| native-host | slave | 164.3 / 208.2, 136.2 / 171.6 | 100.7 / 124.2, 114.7 / 159.9 | 103.8 / 141.7, 102.7 / 143.9 |
| native-host-30ms | master | 134.4 / 168.2, 167.3 / 201.4 | 100.4 / 134.5, 100.1 / 102.1 | 100.0 / 102.3, 100.5 / 102.2 |
| native-host-30ms | slave | 211.1 / 281.8, 244.1 / 299.5 | 195.4 / 236.4, 166.6 / 208.5 | 172.7 / 230.6, 138.3 / 196.7 |
| natives | master | 33.7 / 35.0, 33.7 / 35.0 | 33.8 / 35.1, 33.7 / 35.0 | 33.8 / 35.1, 33.8 / 35.0 |
| natives | slave | 67.3 / 72.2, 66.9 / 68.2 | 33.8 / 35.2, 33.8 / 35.1 | 33.8 / 35.1, 33.9 / 35.1 |
| natives-30ms | master | 69.4 / 81.1, 34.1 / 39.2 | 33.7 / 35.0, 33.6 / 35.0 | 33.7 / 35.0, 33.7 / 35.1 |
| natives-30ms | slave | 111.1 / 129.3, 133.8 / 136.0 | 100.2 / 101.7, 100.2 / 101.6 | 67.0 / 68.3, 67.1 / 68.3 |

Where the time went (two runs each, comma separated):

| game | packet wait in mmulti, slave (median ms): before / after | master: before / after | master holds a complete tic, mean (p95) ms: before / step 2 only / steps 2 and 3 | datagrams a second, master / slave: before / after |
|---|---|---|---|---|
| browsers | 23.4, 27.2 / 0.0, 0.0 | 24.9, 29.6 / 0.0, 0.0 | 9.2 (29.1), 6.3 (20.3) / 3.7 (20.0), 8.5 (21.2) / 0.0 (0.0), 0.0 (0.0) | 31.8, 31.4 / 31.8, 31.2 / 52.6, 53.1 / 55.8, 57.1 |
| browsers-30ms | 24.0, 27.4 / 0.0, 0.0 | 27.2, 28.5 / 0.0, 0.0 | 8.3 (23.4), 7.0 (20.7) / 9.4 (31.5), 9.7 (28.8) / 0.0 (0.0), 0.0 (0.0) | 31.8, 31.5 / 31.7, 31.3 / 52.1, 51.2 / 55.7, 53.7 |
| browser-host | 13.5, 13.7 / 0.1, 0.1 | 29.1, 28.5 / 0.1, 0.1 | 6.7 (24.2), 7.0 (27.1) / 9.5 (23.6), 7.1 (30.9) / 0.0 (0.0), 0.0 (0.0) | 29.8, 29.3 / 39.5, 39.6 / 52.6, 50.7 / 59.4, 59.4 |
| browser-host-30ms | 14.0, 14.0 / 0.0, 0.0 | 27.9, 26.9 / 0.0, 0.0 | 8.3 (30.7), 10.1 (32.2) / 9.9 (25.4), 4.9 (24.2) / 0.0 (0.0), 0.0 (0.0) | 29.4, 30.3 / 39.5, 39.5 / 52.1, 52.4 / 59.3, 59.3 |
| native-host | 30.2, 30.4 / 0.1, 0.1 | 13.8, 14.1 / 0.1, 0.1 | 16.8 (29.4), 14.3 (29.7) / 21.1 (27.5), 13.9 (31.2) / 0.0 (0.0), 0.0 (0.0) | 39.6, 39.5 / 28.8, 29.3 / 54.4, 56.8 / 53.2, 55.4 |
| native-host-30ms | 29.1, 28.8 / 0.0, 0.0 | 13.9, 13.5 / 0.0, 0.0 | 18.8 (29.7), 16.2 (30.9) / 20.5 (28.8), 11.2 (30.9) / 0.0 (0.0), 0.0 (0.0) | 39.6, 39.5 / 29.4, 28.3 / 55.1, 55.8 / 53.3, 54.7 |
| natives | 13.3, 14.2 / 0.0, 0.0 | 12.4, 14.1 / 0.0, 0.0 | 10.2 (30.5), 18.7 (29.9) / 0.0 (0.0), 0.0 (0.0) / 0.0 (0.0), 0.0 (0.0) | 39.5, 39.5 / 39.6, 39.6 / 59.4, 59.5 / 59.6, 59.6 |
| natives-30ms | 13.0, 13.3 / 0.0, 0.0 | 11.0, 12.7 / 0.0, 0.0 | 16.7 (31.6), 14.1 (31.4) / 10.7 (12.4), 10.7 (12.3) / 0.0 (0.0), 0.0 (0.0) | 39.5, 39.5 / 39.5, 39.5 / 59.4, 59.4 / 59.5, 59.5 |

The cut per step, as the mean of the two runs' medians (ms; a negative number is a cut):

| game | slave: before | step 2 only | steps 2 and 3 (step 3's share) |
|---|---|---|---|
| browsers | 136 | 121 (-14) | 102 (-34; -19) |
| browsers, 30 ms | 218 | 185 (-33) | 175 (-42; -9) |
| browser host + native | 161 | 101 (-60) | 101 (-60; 0) |
| browser host + native, 30 ms | 201 | 184 (-16) | 168 (-33; -17) |
| native host + browser | 150 | 108 (-43) | 103 (-47; -4) |
| native host + browser, 30 ms | 228 | 181 (-47) | 156 (-72; -26) |
| natives | 67 | 34 (-33) | 34 (-33; 0) |
| natives, 30 ms | 122 | 100 (-22) | 67 (-55; -33) |

- **Slaves** gain in every pairing: 33 to 72 ms with both steps (one to two tics), 34 ms (one tic) between natives, 55 ms with 30 ms each way. Step 2 is most of it (it removes the 13 to 30 ms wait in mmulti on the way to the master and again on the way back, in whole tics because of the lockstep buffer). Step 3 adds one tic for two natives with 30 ms each way (100 to 67 in all three runs of the final build), 9 to 26 ms elsewhere with 30 ms, and nothing measurable unimpaired (0 to 19, inside the noise).
- **Masters** fall or stay the same within the noise (natives 34, 34; natives with 30 ms 52 to 34; native host with 30 ms 151 to 100; browsers 85, 67, 85: the figures hop between 67 and 100 ms, whole tics of `bufferjitter`, from run to run of the same build).
- **The wire.** The send wait is gone: 13 to 30 ms at the median before (a browser's packets 23 to 30, a native machine's 12 to 14), 0.0 to 0.1 after. **Datagrams per peer**: 28 to 40 a second before, 50 to 60 after (1.4 to 2.0 times: about one per input plus the acknowledgements the window still paces); the test bound is 80. As in jfSW, many of the extra ones are redundant: `faketimerhandler()` calls `getpackets()` before it makes the input, `getpacket()` spends the window on a datagram with only acknowledgements, and the input's flush then sends the same acknowledgements with the new data (`-testlag` counts them: see the `lag` log lines). A later cut (no acknowledgement-only datagram when an input is about to follow) needs a change in `mmulti.c`'s pacing and was not made. Brief 06 should size the relay for about 60 datagrams a second per player and direction.
- **Step 3's share on the master.** The master's wait for its own next tick is gone: mean 6 to 21 ms (p95 20 to 32) with step 2 only, 0.0 (p95 0.0) after, in every game. It is measurable end to end only where the noise is small (two natives with 30 ms, above); in the browser games it is below the spread between runs. It is kept for the 10 to 21 ms mean wait of a native master with a browser guest, up to a tic at p95 for every master, and one tic for natives with 30 ms.
- **Lag correction.** It settles: after tic 200 the clock was not corrected at all in 146 of the 154 machine-games measured and once, by 4 clock ticks (one game tic), in the other 8 (`-f4`); `otherminlag` stayed within -2 to 2 and `bufferjitter` at 1 to 2 tics (a native master) or 2 to 6 (browser machines, higher with 30 ms); the `lag` check allows at most 10 corrections and 2 reversals. **The lockstep buffer (`bufferjitter`) is the largest cost left**: a browser machine's 2 to 4 tics is 66 to 133 ms of "complete to tic" waiting; it is the lag-correction algorithm, out of scope (reported, not changed). It moves in whole tics and makes the single-run figures of browser pairings jump by a tic or more.
- **`-f2` and `-f4`** (`movesperpacket` 2 and 4; native games and a browser, median ms, before / step 2 only / both): `-f2` natives slave 99 / 59 / 63, master 65 / 61 / 65; natives with 30 ms slave 166 / 116 / 93, master 91 / 62 / 63; native host + browser slave 198 / 108 / 88, master 134 / 98 / 67. `-f4` natives slave 132 / 98 / 98, master 73 / 99 / 89; natives with 30 ms slave 132 / 131 / 96; native host + browser slave 236 / 177 / 155, master 135 / 101 / 132 (one run each; they agreed record for record in all 18 games). Datagrams per peer 39.5 / 44.8 / 44.9 at `-f2` and `-f4` (a packet per 2 or 4 tics, plus the paced acknowledgements).
- **Agreement.** Every measured game agreed record for record: 48 `lag-matrix` games (six runs of eight games, 144 checks each), the 18 games at `-f2`/`-f4` (six runs of three, 52 checks each), the `lag`, `lag-batch` and `tic1` games, and the full run below.

**The tic-1 check** (jfSW's L-found case: a machine that ran tic 1 after a single drawn frame differed from one that drew more). **Duke does not differ.** `tic1` runs 8 games, two in each of the four pairings, with `-testslowstart3000` on the master: in every game the master ran tic 1 after exactly one frame and the slave after 150 to 1,870 (frames drawn before tic 1, from the log), and **all 8 agreed record for record and, field by field, in the state dumps at tics 1, 2 and 3**. So there is nothing to investigate with `-teststate`; this is what 04's audit said (no drawing write that the simulation reads), and `enterlevel()` draws a frame (`displayrooms()`) on every machine before the level starts in any case. Not run: a tab hidden before the level's first frame; that is 04's `hidden-level` (in the full run).


**Mutations** (each applied to the final code, rebuilt into its own directory, run with `NETPLAY_GAME`/`WASM_DIR`, reverted)

| Mutation | Run | What failed |
|---|---|---|
| undo step 2 (`SendInputNow()` does not flush) | `lag` | 7 failed: every machine's packets waited 14 to 31 ms in mmulti at the median (bound 5) and the native slave with 30 ms took 100.6 ms at the median (bound 75) |
| undo step 3 (no call in `getpackets()`) | `lag` | 2 failed: the browser master held a complete tic 11.5 / 25.9 ms (median / p95; mean 9.7) and the native master with 30 ms 19.0 / 20.4 (bounds 2 / 8). The slave bound (75) also fails in two of the three runs of this build (100.2, 100.2; the third was 81.3) |
| both undone (the "before" build) | `lag` | 10 failed (both of the above) |
| undone, at `-f2`/`-f4` | `lag-batch` | with the "before" build 9 failed (packet waits 13 to 26 ms, the master's forwarding wait 30 to 73 ms, bounds 5 and 2); with step 3 undone 2 failed (the forwarding wait) |
| step 3 with the receive buffer as the send buffer (`sendmasterpackets()` inside the receive loop, right after a slave's input is stored, before its sync bytes are read from `packbuf`) | `ws`, `native-host` | the master logged `OUT OF SYNC` in both (it read its own outgoing packet's sync bytes as the slave's): 2 failed; the dumps agreed |
| step 3 without the `ready2send` gate | `test-level-exit.sh`, `test-save.sh` | **116 checks failed in `test-level-exit.sh`** (every scenario: the games exit 1 or hang before the first level is left), 20 in `test-save.sh`, 14 in `test-three-games.sh --relay`: without `ready2send` the master forwards empty tics from the start-up barriers (`playerquitflag[]` is 0 until the first level starts), so the gate is needed at start-up as well as at the level end (`bugs.md` D19) |
| the hidden pass's flush removed (step 2 made it redundant) | `hidden-slave`, `hidden-host`, `hidden-thin`, `hidden-frozen` | nothing: 101 passed (30.0 tics a second on both machines; 0 to 2 of 2,100 to 2,700 yields entered with data held back, limit 1% and 5), so it was removed |
| `tic1` without `-testslowstart` (`NETPLAY_NOSLOW=1`) | `tic1` | 9 failed: no game had the uneven start (frames drawn before tic 1: 1 to 4 on the master, 51 to 77 on the slave in the first two) |
| a drawing-dependent write (the 3rd call of `displayrooms()` raises `sector[0].ceilingz`) | `tic1` | 46 failed: the dumps differ at tic 1 (`sectors`), the field comparison names `sector 0 ceilingz: -39936 against -39935`, and the machines logged `OUT OF SYNC` |

**Tests** (final code, rebuilt native and wasm; one test at a time under `flock`; load average 2.3 to 5.5 on 4 shared cores)

- `node tests/web/netplay.js` (every scenario but `lag-matrix`, 33 minutes): **1,041 passed, 0 failed** (`lag` 82 checks, `lag-batch` 97, `tic1` 153, the 24 scenarios of 04 the rest). `lag`: two browsers master 67.4 / slave 113.3 ms at the median; native host + browser master 67.1 / slave 105.0; two natives with 30 ms each way master 33.8 / slave 67.1 (bound 75); packet waits 0.0 to 0.1 ms at the median, forwarding 0.0 / 0.0, datagrams 52 to 60 a second.
- `make test GAME_RUNS=1`: **exit 0, 22 PASS** (includes `make test-net` with the three new lines, `test-level-exit.sh` at `-f4`, `test-save.sh`, `test-udp-unchanged.sh`: plain UDP with the flush still talks to the pre-brief-01 game, and `test-menu-f4.sh`, which ran; no NOT RUN) in 21 minutes.
- By hand, the same suites at the other `movesperpacket`: `test-three-games.sh --relay --mpp 2|4 --fire --tics 600` PASS, `--udp --mpp 2|4 --tics 600` PASS, `test-level-exit.sh --mpp 2` and `--mpp 4` (`relay-slave`, `relay-master`, `relay-late`, `udp-slave`) PASS.
- **Peer-to-peer** (`-net -np -p48870 "*" 127.0.0.1:48871`, two native games over plain UDP; no test in the suite): the dumps are identical (400 tics, 398 sync checks, 0 mismatches). It exercises the flush after packets 16 and 17.
- The rest of `make test-web` one by one (its `netplay.js` step was run above): `grptable.js` 12 passed, `data.js` 193, `con.js` 17, `smoke.js` 36, `persist.js` 18, `focus.js` 24, `menu-keys.js` 23, `loops.js` 18, **`determinism.js` 22 passed, 0 failed (strict)**, `frametime.js` 3 passed, **1 failed: the known "no stall over 100 ms" check** (max 119 ms, p99 70.8 ms, load 3.7: software-rendered Chromium).
- Native build: the same warnings as before, none in what 04b added.

**Concerns**

- *Step 3 for browsers* is a mechanism gain (the master's forwarding wait is gone: 0.0 ms) whose end-to-end effect in browser games is below the run-to-run noise of this container (browser pairings: the same build gives 67 and 100 ms at the master in two runs); the clear end-to-end gain is natives with 30 ms (one tic).
- *The buffer.* After 04b the lockstep buffer (`bufferjitter`, 2 to 4 tics for a browser) is the largest part of a browser guest's delay. It is the lag-correction algorithm (out of scope).
- *Datagram rate* about doubles at most (1.4 to 2.0 times), and many extra datagrams are redundant acknowledgements; a relay serving many rooms sees that (brief 06).
- *The `ready2send` gate is load-bearing.* Without it every network game fails (mutation table; `bugs.md` D19): `sendmasterpackets()` has no idea whether a level is running.
- *Not done:* a native-only `-f2`/`-f4` relay game with a browser guest hidden; Firefox, a real GPU, a real network; the MSVC build of the `-testlag` timer.

**Play-test steps (Arch Linux)**

```
sudo pacman -S --needed base-devel git unzip python nodejs npm go sdl2 libvorbis libogg mesa glu alsa-lib gtk3
git clone --recurse-submodules -b browser/04b-lag-cuts https://github.com/VenKamikaze/jfduke3d-browser
cd jfduke3d-browser
scripts/setup-emsdk.sh && scripts/build-wasm.sh && scripts/fetch-test-data.sh && make -j4
(cd ext/vnet/relay && go build -o /tmp/vnet-relay ./cmd/vnet-relay)
/tmp/vnet-relay -udp 127.0.0.1:7777 -http 127.0.0.1:7778 -origins 127.0.0.1:8000 -v       # terminal 1
```

Host natively and join from the browser (the page needs `?test=1`, see 04's play-test), or the other way round; compare with `git worktree add ../jfd-claude claude` built the same way. Things only a person can check:
- **Does shooting, using doors and changing weapons feel sooner as the guest?** About one tic (33 ms) or more at the median, more with latency; the host about the same or a little sooner. Movement and turning were predicted and should feel unchanged.
- **Over a real network** (the relay on another machine, Wi-Fi): the same comparison, and that the game does not stutter more than before (the datagram rate is up to twice what it was).
- **The tests on your own machine:** `node tests/web/netplay.js lag tic1 lag-batch`, and `node tests/web/netplay.js lag-matrix` for the full table (about 12 minutes; the numbers will be lower and steadier than here).

### Fix round (independent review of `bf9e4ab`, 19 Nov 2026)

The review found no blocker and two should-fix items; both are fixed on this branch (`3f35166`; the intermediate commits are work in progress).

**1. The `ready2send` gate did not cover `newgame()`'s first barrier (reasoning by the reviewer; confirmed by a print).** `newgame()` runs `waitforeverybody()` while `ready2send` is still 1 (it sets it to 0 after the barrier), and so do `saveplayer()`'s two barriers. A master reaches them with a full queue (a new game from the menu in the middle of a game, a packet 5 or 8 from a slave, a multiplayer save), so the nested `getpackets()` could forward tics after the master's ready packet; a packet 0 has no tic number and no `waitingfornewlevel` guard, so one that reached a slave after its `clearfifo()` would be taken for a tic of the new level. A temporary print showed it happening: with 500 ms on the slave's datagrams and a new game after 100 tics the master forwarded tics 101 to 108 from inside the barrier (before 04b it never forwarded in one).
- *Fix:* `waitforeverybody()` counts itself in and out (`inbarrier`, a counter, `src/global.c`, `src/premap.c` CRLF kept), and the new call in `getpackets()` needs `!inbarrier`. Chosen over saving and clearing `ready2send` in `waitforeverybody()` because that variable has other readers (`faketimerhandler()`, the loops) and nested level starts inside a barrier (packet 5) set it themselves; a counter that only the new call reads cannot change anything else, and it nests. With it **no barrier forwards anything, as before 04b**, so `saveplayer()`'s barriers behave as they did (the Outcome's earlier sentence that the master forwards complete tics inside them "sooner" is withdrawn, here and in `code-facts.md` §21.1).
- *Test:* `-testnewgame<T>` (test-only: this machine starts a new game, packet 5, as the menu does, after T tics) and the `netplay.js` scenario `newgame` (natives with 250 ms, with 100 ms and 100 ms of jitter, a slave starting it with 150 ms, three players with 200 ms, 700 ms on the slave's datagrams with a short game, a browser master with 150 ms): every machine's dump from its last "tic 1" on must be identical, and no machine may log `TEST: the master forwarded tic N inside a barrier` (the game logs it if a forward happens inside a barrier, which the fix makes impossible). **Without the `!inbarrier` condition the scenario fails (3 checks: that line in the three games with latency)**, deterministically. **The race itself could not be forced into a desync or a crash by a build with only that condition removed**: every such run agreed. The slave's `flushpackets()` before its second barrier drops what has arrived by then and the map load takes longer than the latencies tried (up to 700 ms); an earlier build without the condition and without the nudge fix of item 2 hung the master and crashed the slave once (exit 139) with 700 ms and a new game after 100 tics, but that is not attributable to the barrier alone. So the scenario shows that the rule holds and that a new game under latency agrees, not that the unprotected race corrupts a game.

**2. Step 3 stalled the slave at 400 ms and more (the reviewer's repro, reproduced).** With 500 ms on the slave's datagrams, `-testsync -testfire150 -testquit350`: the original game and step 2 played all 350 tics; step 3 left the slave at 303 to 320 of 350 in 6 of 6 runs (`-testlag`: the slave's `bufferjitter` 58 and `otherminlag` 45 at tic 276, the master's `ran - made` 2.4 s).
- *Root cause:* the 127 **resend nudge** in `faketimerhandler()`. The master sends a one byte packet 127 to every slave at each tick at which the next tic is still incomplete. Before step 3 a tick that found a tic complete sent it and no nudge; with step 3 the tic had already gone out from `getpackets()` and the tick sent a nudge **as well**: one more reliable packet per tic. Every mmulti datagram resends all unacknowledged packets oldest first and leaves out the newest that do not fit in its 256 bytes (214 for packets); with 500 ms on the slave's datagrams the master has 15 to 20 packets unacknowledged, and the nudges made them too many. The newest tics were held back until older ones were acknowledged, the slave's lag correction fell behind further and further (a feedback: `bufferjitter` follows the worst lag, the clock correction follows `otherminlag`), and its game ended before the master's last tics reached it. No desync, only a stall.
- *Evidence:* a scratch build with `MAXPAKSIZ` 576 passed; one without the master's flush in `sendmasterpackets()` still stalled (so it is not the flush); one that sends no nudge at a tick that forwarded a tic passed; 400 ms with `-testsync` ended at 349 of 350, without `-testsync` (smaller packets) it passed.
- *Fix:* the nudge is sent only at a tick that forwarded nothing (`masterfwdsincetick`, `src/game.c`): the same packets, in the same number, as before step 3. It changes when a resend nudge is sent, not what any packet contains.
- *Test:* `netplay.js` `lag-highlat`: 500 ms on the slave's datagrams (two natives, firing inputs) and 400 ms with a browser slave, 350 tics, both machines must play them all and agree. **The step 3 build without the fix fails it (9 checks: the slave ends at 296 to 308 of 350 tics, both pairings); the step 2 build and the fixed build pass (32 checks).**
- *What is left is the original game's:* with 500 ms the baseline stalls too, later: at about 640 to 690 tics of 700 (before 643 and 690, step 2 692, the fixed build 653 to 655, step 3 565 before the fix), because a 256 byte datagram cannot carry an RTT's worth of packets at 30 tics a second. It needs an engine change (a larger datagram, shared with jfSW and incompatible with older builds) or fewer packets (`-f2`); recorded as `bugs.md` D20, **not fixed here**; nothing upstream-style to put on a `fix/` branch.

**3. Nits.** The documentation says which barriers forward (none now). Line references re-checked after the edits (`code-facts.md` §21.1: `SendInputNow()` `src/game.c:459`, its calls `:980`, `:1043`, `:1162`, the new call `:832`, the nudge `:1056`, `masterfwdsincetick` `:449`).

**Results of the round** (rebuilt native and wasm; `premap.c` has 1,647 CRs in 1,647 lines, `menues.c` was not touched; one at a time under `flock`):
- `make test GAME_RUNS=1`: **exit 0, 22 PASS** (it runs `test-save.sh`, `test-level-exit.sh` with and without `--mpp 4`, the three-games runs including `--mpp 2` and `--udp --mpp 4`, `test-udp-unchanged.sh`).
- `node tests/web/netplay.js` (all scenarios, 33 minutes): **1,190 passed, 0 failed** (`newgame` 104 and `lag-highlat` 32 are new).
- `node tests/web/determinism.js` (strict): **22 passed, 0 failed**.
- Quick `lag-matrix` rerun of the final build (one run; load 2.6 to 5.5): median input to tic, master / slave: natives 33.8 / 33.9 (before 33.7 / 67), natives with 30 ms 33.7 / 67.1 (before 52 / 122), two browsers 103 / 104 (before 85 / 136), browser host + native 107 / 134 (before 105 / 161), native host + browser 134 / 108 (before 84 / 150); forwarding wait 0.0 ms in all five, packet wait 0.0 to 0.1 ms, datagrams 49 to 60 a second. The step 3 gains hold (natives with 30 ms: the slave 67 again; the browser figures are inside the run-to-run noise as before).
- Not run again: `make test-web`'s other steps (`grptable`, `data`, `con`, `smoke`, `persist`, `focus`, `menu-keys`, `loops`, `frametime`): the round changed no page, no wasm-only code and no data code (the wasm build was rebuilt and `netplay.js` and `determinism.js` ran against it).

### Corrected in 05

The fix round's claim that `lag-highlat` passes with the fixed build (32 checks) and fails without the fix was **luck in the 400 ms browser-slave case**: on a quiet machine, 8 alternating runs each, the 04b and the 05 builds both completed 1 time in 8. The host quits at `-testquit350` while a lagging slave is still at tic 316 to 343 (the original game's datagram limit, D20, with `-testsync`'s larger packets and a frame-driven slave), so `make test-web` was red on both. The nudge fix itself is real: without it the 500 ms natives case ends at about 285 to 307 of 350 every time. Brief 05's fix round reshaped the scenario (no `-testsync`; natives 500 ms plus a browser slave at 300 ms) and measured it (6 of 6 on the current code, 3 of 3 failing without the fix): see its Outcome. The figures above stand as written for the history; the scenario's pass/fail claim does not.

## State

**Fix round finished 19 Nov 2026, status review** (Outcome and "Fix round" above). Worktree `/home/user/wt-d04b` (branch `browser/04b-lag-cuts`; kept). Variant builds and logs: `/home/user/d04b-variants/`, `/home/user/d04b-logs/` (not in git).

**Done:** everything in the Outcome; the fix round: `inbarrier` (no forward inside a barrier), the nudge only at a tick that forwarded nothing, `-testnewgame`, scenarios `newgame` and `lag-highlat`, `bugs.md` D20, docs corrected; `make test` 22 PASS, `netplay.js` 1,190/0, strict `determinism.js` 22/0, the `lag-matrix` gains confirmed.

**To do (the coordinator):** re-review the fix round if wanted; merge `--no-ff` into `claude` (no fork change); update PROMPT.md section 0 and the README row's status.

**Open problems:** none new. Known and reported: the original game's stall at about 500 ms on a slave's datagrams (`bugs.md` D20); `frametime.js`'s 100 ms stall check; the lockstep buffer is the largest delay left; the datagram rate is up to twice the old one; the barrier race itself was not forced into a failure.
