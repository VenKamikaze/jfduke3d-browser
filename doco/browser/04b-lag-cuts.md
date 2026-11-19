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

1. **The input waits for the send window.** Same here. `faketimerhandler()` calls `getpackets()` (`src/game.c:803`) before `getinput()` makes the input; `getpacket()` calls `dosendpackets()` for every peer first (`jfbuild/src/mmulti.c:1184`); `dosendpackets()` returns inside the 25 ms window (`PAKRATE 40`, `:1127`) and otherwise sends a datagram with the acknowledgements and resends. The input's own `sendpacket()` then finds the window used. The input leaves at the next `dosendpackets()` after the window. The jfbuild fork is shared, so the code is identical to jfSW's.
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
- **The level-change rules.** (D5) No new play after the exit tic: the forward is gated on `ready2send`, which the main loop clears at `MODE_EOL` before anything else can forward. (D6) The `MODE_EOL` branch still calls `sendmasterpackets(movefifoplc)` first. (D11, `waitingfornewlevel`) A forward from `getpackets()` can only send tics for which the master's own input exists; after `clearfifo()` its own `movefifoend` is 0 and no input of the new level exists until the first `faketimerhandler()` after the barrier, so nothing stale can be forwarded, and the slave's stale-input guard is untouched. The barriers of `saveplayer()` clear nothing and the master may now forward complete tics inside them: the same tics, earlier; `test-save.sh` runs against it.

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

(To be written when the work is done.)

## State

Updated after each step. **Started 19 Nov 2026.** Worktree `/home/user/wt-d04b` (branch `browser/04b-lag-cuts`, from `origin/claude` `6d8302e`); native and wasm builds in it work (`make -j4`, `EMSDK_DIR=~/.cache/jfsw-browser/emsdk scripts/build-wasm.sh`, test data copied to `testdata/`). Variant builds for the before/after table are in `/home/user/d04b-variants/` (`before-`, `step2-`, `step3-` `duke3d` and `wasm`; `snap.sh NAME` copies the current build; they are not in git); logs of the measurement runs in `/home/user/d04b-logs/`.

**Done:** the brief; step 1 (`-testlag`, `-testslowstart`, the `lag`, `lag-matrix`, `tic1`, `lag-batch` scenarios); step 2 (`SendInputNow()`); step 3 (`getpackets()` forwards); two `lag-matrix` runs of each variant (all agreed, 144 checks each); `lag` and `tic1` pass on the final code.

**To do, in order:**

1. `lag-batch` (`-f2`, `-f4`) result; `test-three-games.sh --mpp 2|4`.
2. Mutations (revert step 2, step 3, both; receive buffer as send buffer; `tic1` without `-testslowstart` and with a drawing-dependent write; the hidden pass's flush removed with the four hidden scenarios) and, if the flush is redundant, remove it.
3. Regression: all of `netplay.js`, `tests/net/test-level-exit.sh`, `test-save.sh`, `make test`, `make test-net`, `make test-web`, `determinism.js`.
4. Docs: `code-facts.md` §21, `bugs.md`, `building.md`, README row; the Outcome here.

**Open problems:** none yet.
