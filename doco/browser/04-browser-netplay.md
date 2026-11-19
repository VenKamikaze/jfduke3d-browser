# 04: Browser netplay, the hidden-tab pass and the drawing-state audit

## Goal

The browser build plays network games over vnet, the same relay room can hold browser and native players in any mix with either one hosting, and every machine agrees on every tic. A tab that goes hidden keeps the room playing. Drawing leaves nothing behind that the simulation reads, so a machine that does not draw (a hidden tab) and a machine that does stay in sync.

This is jfSW's brief 04 (browser netplay and the hidden-tab pass) and 04c (the drawing-state audit, L19) together, redone for Duke: the engine side (vnet in the wasm build, the wake callback, the hidden yield, the test knobs) is already in the shared `jfbuild` fork at the pinned commit and is reused as it is. What is new is the game side (the hidden pass in `src/game.c`), the page's last test knob, the audit of Duke's drawing code, and the tests.

## Read first

- [`README.md`](README.md): D4, D5, D14 (the shareware network gate), Q5, "Working across repos", "Bugs found in the original game".
- [`code-facts.md`](code-facts.md): §2 (the netcode), §4 (blocking loops), §10, §15 (the test hooks and the `-testdump` file), §16, §17 (A1's audit, **17.4 is the drawing-write catalogue for this brief**), §18, §19.
- The Outcomes of [01](01-native-relay.md), [02](02-emscripten-port.md), [03](03-data-download.md), [A1](A1-determinism-audit.md).
- [`bugs.md`](bugs.md) (D numbers; new ones here start at **D17**).
- jfSW, `doco/browser/` on `claude` in `jfsw-browser`: `04-browser-netplay.md` and `04c-hidden-first-frame.md` with their Outcomes, `porting-jfduke3d.md` (rows 04 and 04c, section 3, L19), `tests/web/netplay.js`, `tests/web/lib.js`, and how `src/game.c` and `src/net.c` wire `HiddenNetPass()`.
- The engine side that is reused: `jfbuild/src/sdlayer2.c` (`jfbuild_browser_hidden_netgame`, `jfbuild_browser_wake`, `jfbuild_browser_yield`, `handleevents()`'s hidden-tab yield), `jfbuild/src/mmulti_vnet.c` (`onwake`, the test knobs), `jfbuild/src/mmulti.c` (`__EMSCRIPTEN__`), and `web/jfduke3d.js` (`Module.jfswKnobs`, the test hooks).

## In scope

### 1. Browser netplay

- The browser build already links the real vnet-backed `mmulti.c` (02). Check it end to end: `-net -relay ws://HOST/vnet -host-room N` and `-room CODE` from `?test=1&args=`, with `-allowsharewarenet` where the shareware gate needs it (below).
- **The test knobs** (`?relay_wt=`, `?relay_cert=`, `?impair=`, read from the address only with `?test=1` and `testMode: true`) are in the page already; add `?wake_every=N` (jfSW's: only every Nth wake-up gets through, to imitate a quiet peer). Nothing here is settable from an address on a normal page.
- **The shareware gate (D14) applies unchanged.** The test pages are served a `config.js` that sets `allowSharewareNetGames: true` (the tests' own copy, as they already serve `testMode: true`); the default config is never weakened and the setting is never read from the address. One browser test shows that **with the default config a browser net game on the shareware GRP is refused** with the game's message on the end-of-game overlay. (Hiding the menu entries is 05.)
- **Failures** end on the page's overlay with the game's message: relay unreachable, no such room, room full, a bad code, the host gone during the wait, plain `-net` without `-relay`, a relay session lost during the game (L18, 01's `NetLostCheck`).
- Starting a game without `?test=1` (`?host=`, `?join=`, a lobby, Duke's menus) is brief 05 and is not built here.

### 2. The hidden-tab pass

A hidden tab has no animation frames and about one timer run a second. A lockstep game then stalls everyone, so a hidden tab in a **network** game is driven by network events instead (a hidden single player game still pauses, as in 02):

- The engine already does the waiting: with a relay session and `document.hidden`, `handleevents()` and `showframe()` yield until vnet's wake callback posts a `MessageChannel` message (never `setTimeout`, which is throttled), the page becomes visible, or a 250 ms timer fires (for vnet's own deadlines).
- **The game side is new.** In `app_main`'s loop, when the tab is hidden and a relay session exists: draw nothing (`displayrooms`, `displayrest`, `nextpage`), and run a hidden pass that does what drawing would have done for the network: the engine calls `faketimerhandler()` (which makes and sends this player's input for a tic) from inside its drawing code (`code-facts.md` §2.3), so a pass that does not draw must call it itself, as many times as the tab's own clock says inputs are due (a bounded few, catching up to its clock, never ahead of it), then `moveloop()` (receive and move every tic whose inputs are in), `checksync()` (the sync ring is 256 entries; a hidden tab that never compared would let it wrap and report false differences when it was shown again), and a **flush** after every pass (`mmulti_vnet_flush()`: the 25 ms send window, `PAKRATE`, must not hold an input back until the next network event; jfSW 04 S1).
- `-testquit`, the level exit (`MODE_EOL`) and a hidden pass in the middle of a level change (`enterlevel`'s `waitforeverybody()` already pumps `handleevents()` and `getpackets()`, so it is driven by the wake callback in a hidden tab) must work. The bonus screens' waits for a key are brief 05; the level-exit test uses co-op, where `dobonus()` returns at once.
- A hidden host works the same way (a slave's packet wakes it). A tab frozen for a few seconds does not end the game.

### 3. The drawing-state audit (jfSW's 04c, L19)

Drawing must not leave state that the simulation reads: a hidden tab does not draw, a visible one does, and they must produce the same simulation. A1 catalogued the candidates (`code-facts.md` §17.4). This brief:

- **Audits every write the drawing code makes**, with a verdict per write ("the simulation reads it: fixed" or "it does not: why not"): the A1 catalogue (`hittype.dispicnum`, `sprite.yoffset` of a player's sprite, the viewscreen sprites' `T1` and `owner` in `animatecamsprite()`, `ps[].orotscrnang`, `ps[].visibility`, the camera and redraw globals), and everything that `displayrooms()`, `animatesprites()`, the mirror code, `animatecamsprite()`, `drawbackground()` (and what they call in `src/`: `displayrest()`, `drawoverheadmap()`, the HUD) write to `sprite[]`, `sector[]`, `wall[]`, `hittype[]`, `ps[]`, `ud` or globals. And the other direction: what the simulation reads that a drawing path sets. The engine's own drawing (`jfbuild/src/engine.c`'s `drawrooms()`/`drawmasks()`) is checked for writes to the map and sprite arrays.
- **Fixes what matters**, each on its own `fix/...` branch from `master` where it is a bug of the original game (at most 3; the rest recorded in `bugs.md`, numbers D17 and up), upstream-friendly, line endings kept.
- **Re-examines what A1 left out of, or in, the state hash only as drawing noise**: the viewscreen sprites' `T1` and `owner` are still in the hash and differ between a drawing and a non-drawing machine; they are removed from the hash only if the audit shows nothing reads them, and the hash must still catch what the simulation does read.
- **Shows by test** that a hidden tab (no drawing) and visible machines (drawing) stay in sync over a game that exercises what the audit found (security cameras and mirrors, if the shareware maps allow it: the audit finds out which maps have them and where).

### 4. The browser tests

`tests/web/netplay.js` (new, jfSW's with Duke's names): a local vnet relay built as 01's tests build it, machines that are browsers (Playwright and the preinstalled Chromium; never `playwright install`) or native games (`scripts/run-headless.sh`), games started by `?test=1&args=`, every machine's own `-testdump` compared record for record (Duke's record is 32 bytes: tic, random seed and six FNV-1a hashes: players, sprites, hittype, sectors, walls, other). Scenarios (each runnable by name; `--list`):

| Scenario | What |
|---|---|
| `ws`, `ws3` | two and three browsers |
| `browser-host`, `native-host` | a browser host with a native joiner and the other way round |
| `mixed3` | three players, browsers and a native one, the browser hosting |
| `level-exit` | a browser case that leaves E1L1 at tic 200 (A1's `-testexit`) and plays on: both levels' dumps and the second level's state agree |
| `impaired` | latency, loss, duplication, reordering on every machine |
| `hidden-slave`, `hidden-host`, `hidden-thin`, `hidden-frozen`, `hidden-local` | a hidden, throttled tab as slave and as host; a quiet peer (every 6th wake); a hidden tab frozen for 3 s; a hidden single player game still pauses |
| `draw-state` | a hidden tab and visible machines over a game that goes where the audit says drawing writes state (cameras, mirrors) |
| `frozen-slave`, `frozen-host`, `relay-lost` | a tab frozen for 5 s; a session the relay dropped |
| `nudge-slave`, `nudge-master` | `-testnudge` is seen: both machines' dumps differ from that tic on and every machine logs the sync difference |
| `errors`, `knobs`, `gate` | the failure messages on the overlay; the knobs only with `?test=1`; the default config refuses a shareware network game |
| `wt` | two browsers over WebTransport (a `-dev-cert` relay), if Chromium here supports it (otherwise recorded as not run) |

Playwright cannot hide a tab: the tests imitate one as jfSW's do (`document.hidden` and `visibilityState` overridden, a `visibilitychange` event, no animation frames, timers held to one second, WebSocket and `MessageChannel` events left alone). The tic rate is measured on every machine from the dump sizes; Duke's nominal rate is **30 tics a second** (`TICRATE 120`, `TICSPERFRAME 4`), jfSW's 40.

## Out of scope

- **04b**, the lag cuts (the input-to-tic delay: `-testlag`, sending an input at once on every machine, the master forwarding at once). The hidden pass here flushes after every pass, as 04 did; 04b generalises that.
- **05**: the host/join UI, the lobby overlay, "Start now", Duke's menus and console, the startup window, and the hidden-tab `dobonus` (L23, a DukeMatch level end).
- **05b**, the data and build warning. 06 deployment.
- Joining mid-game (D2), peer-to-peer over the relay (D5), music (Q4), WebGL (D6).
- Changes to vnet. Changes to a shared fork unless a game-side change cannot do it (then: a branch of the fork, behind a run-time switch or Duke-specific, both games' `make test` run on it, the pin moved only after that).
- Sending anything upstream.

## Acceptance criteria

1. **Browser netplay works**: two browsers; a browser host with a native joiner and a native host with a browser joiner; three players mixed. Each game plays at least 1200 tics, ends with `-testquit`, logs no desync, and **every machine's `-testdump` is identical** record for record. A level exit (`-testexit`) in at least one browser case: every machine plays the same tics of E1L1, leaves, and agrees through the next level's start and tics. Impaired links, lost relay and the failure messages at parity with jfSW's tests where they apply.
2. **A hidden tab keeps the room going.** A hidden throttled browser master and a hidden slave each keep the other machines at **at least 90 % of the nominal rate** (30 tics a second, over at least 30 s, measured from a margin after the hide), the hidden tab draws nothing and is driven by network events, not the timer, and all dumps stay identical. The same test with the hidden pass or the wake handler disabled **fails**.
3. **The drawing-state audit** gives a verdict for every drawing write A1 catalogued and for those found in `displayrooms`, `animatesprites`, the mirror code, `animatecamsprite` and `drawbackground`; what matters is fixed (or recorded in `bugs.md`); a test shows a hidden and a visible machine in sync over cameras and mirrors (if the shareware maps allow it); anything taken out of the state hash is justified by the audit.
4. **Every new test fails without its fix or feature** (a mutation is applied, built, run, reverted, and listed in the Outcome).
5. **No regressions**: `make test`, `make test-net`, `make test-web` pass (the known caveats reported: `frametime.js`'s 100 ms stall check, and a NOT RUN is not a pass), `tests/web/determinism.js` strict, native gcc and wasm identical.
6. **Docs**: this brief's Outcome, `code-facts.md` §20, `bugs.md` (D17 and up), `building.md`, and this brief's row in `README.md` only. `PROMPT.md` is not edited.

## Tests

- `node tests/web/netplay.js [scenario ...]` (new), `--list`. Ports 48400 to 48499 (moved by `JFDUKE3D_WEB_PORT_OFFSET`); native network tests keep 47400 and up. One scenario at a time, under `flock /tmp/jfd-heavy-tests.lock`: the tests are real time and the container has 4 shared cores. Rates are reported with the load.
- Test-only hooks in the game (inert without their argument): whatever the cameras-and-mirrors scenario needs to put players where the audit says drawing writes state, and nothing that changes the simulation without its argument.
- Native tests (`tests/net/`): a game-side test if a fix needs one (a fix to the original game has a test that fails without it, native if it can be).
- Mutations, one at a time, each rebuilt, run, reverted: the wake handler emptied; `HiddenNetPass()` without `faketimerhandler()`; the flush removed; the hidden pass drawing; the knob gate opened; the default gate removed; the sync check left out of the hidden pass (if a test can see it); each audit fix removed; `-testnudge` and a flipped byte for the dump comparison.
- Regression: `make test`, `make test-net`, `make test-web`, `determinism.js`.

## Dependencies

01 (native relay, test hooks), 02 (the browser build and page), 03 (the data download, the `config.js` that carries `allowSharewareNetGames`), A1 (the level-exit fixes and `-testexit`, the catalogue). Brief 05 depends on this one.

## Notes

- Repos touched: jfduke3d-browser only unless a fork change turns out to be needed (the Outcome says).
- Duke's differences that shape the work: no `net.c`, the loop is inline in `app_main`; 30 tics a second; every machine compares the sync byte, but one byte per 8 tics (every tic with `-testsync`) and positions only; the out-of-sync message is logged by 01's `NetSyncDiffers`.
- After a fix to the original game: the committed demos replay identically and native against wasm still agrees (`tests/web/determinism.js`).
- Line endings: `src/menues.c`, `player.c` and `sector.c` are CRLF; keep each file's, and check before every commit.

## Outcome

## Outcome

Status: **review** (branch `browser/04-browser-netplay` in jfduke3d-browser; fix branch `fix/level-exit-stale-inputs` from `master`). **No fork change**: jfbuild stays at `5950d14`, jfaudiolib and jfmact are untouched, so jfSW's `make test` was not affected and was not run. Nothing was merged, no pull request was opened, `claude` and `master` were not touched. Not tested: a person playing, a tab that is really hidden (Playwright cannot hide one: the imitation is as jfSW's), Firefox and Safari, WebTransport against a real certificate, a registered GRP, Windows or macOS.

@@SHAS@@

**What landed**

- *Reused unchanged from jfSW (the jfbuild fork at `5950d14`):* the vnet-backed `mmulti.c` in the wasm build, the vnet wake callback and `jfbuild_browser_wake()`, the hidden yield in `showframe()` and `handleevents()` (a `MessageChannel` message, never `setTimeout`), `mmulti_vnet_flush()`, the test knobs (`?relay_wt=`, `?relay_cert=`, `?impair=`, test mode only). The browser already played network games after 02; 04 shows it.
- *The hidden pass* (`src/netgame.c` `HiddenNetPass()`, 15 lines in `app_main`'s loop): in a hidden tab with a relay session the loop skips `cheats()`, `nonsharedkeys()`, `displayrooms()`, `displayrest()`, `checksync()` and `nextpage()` and runs `faketimerhandler()` for every input that is due (at most 8), `checksync()` (the sync ring has 256 entries), and `mmulti_vnet_flush()`. Design and what differs from jfSW: `code-facts.md` section 20.2.
- *The audit and its instruments* (`src/testhooks.c`): `-testdrawcheck` (the raw bytes of every simulation table before and after `displayrooms()` and `displayrest()`), `-testnodraw` (the hidden pass without a browser), `-testcam<T>,<n>` and `-testmirror<T>,<n>` (every player in front of a security monitor, pressing use, or a mirror, firing the RPG). Verdicts: `code-facts.md` section 20.3.
- *Tests:* `tests/web/netplay.js` (@@NSCEN@@ scenarios, `--list`), `tests/net/test-nodraw.sh` and two new scenarios of `tests/net/test-level-exit.sh` (both in `make test-net`), `make test-web` runs `netplay.js`.
- *Page:* `?wake_every=N` (test only), and the harmless rejection when a WebTransport session is closed at the game's exit is not reported as a page error (jfSW's 06b; found by the `wt` scenario).
- *Docs:* `code-facts.md` section 20, `bugs.md` D17, D18 (new) and D11 (reproduced, fixed), `building.md`, this Outcome, the README row. `PROMPT.md` is not edited.

@@RESULTS@@

@@MUTATIONS@@

**Decisions** (taken without the coordinator, the most conservative option each time)

1. **No fork change.** Everything engine-side was already in the jfbuild fork at the pin (jfSW's 04 to 06b), so no branch of a fork, no pointer move, no run of jfSW's `make test`.
2. **`HiddenNetPass()` is in `src/netgame.c`** (a new file of ours, Q5), `app_main` has 15 lines. It runs after `moveloop()` in the loop, not before it as jfSW's runs `MoveLoop()` after `faketimerhandler()`: the loop is cyclic and the measured rate is nominal either way.
3. **The pass calls `checksync()`** (jfSW has no such thing): Duke's sync bytes are a ring of 256 entries compared only from the drawing half of the loop; a tab that never compared would report false differences when shown again. The test counts the sync bytes a hidden tab compares (1,498 of 1,500 tics; the mutation without it fails).
4. **The pass keeps its own flush** (04b generalises it to every tab).
5. **`-testnodraw`**: the hidden pass is also reachable natively, so the audit is tested in the fast native suite as well as with browsers (`test-nodraw.sh`, in `make test-net`).
6. **A monitor's `temp_data[0]` and `owner` are out of the state hash; the game is not changed.** Moving the counter out of `hittype[]` would change upstream code for a hash's sake. The audit shows nothing reads either (`code-facts.md` 20.3); the rest of the monitor, and `ps[].newowner`, stay hashed. Reverting this fails `test-nodraw.sh camera` and `draw-state`.
7. **No L19.** Nothing in Duke's drawing is read by the simulation, so there is no draw fix (jfSW's 04c needed one). D17 (floor over floor, not in the shareware maps) and D18 (the monitor note) are recorded, not fixed.
8. **D11 is fixed here** (`fix/level-exit-stale-inputs`, 7 lines): A1 recorded it as a structural hazard that never reproduced and was not planned; the browser test reproduced it (1 desync in 7 games) and a hook (`-testlate`) makes it deterministic. One fix of the allowed three. Peer-to-peer mode (case 17) has the same hazard and is left alone (not tested).
9. **The version byte of packet 6 has room for the sum of all flags under 122 on shareware data**; the two new simulation hooks take the free low bits (1 and 2), `-testlate` and `-testdrawcheck` change nothing a peer sees and have none.
10. **Ports 48400 to 48499** for `netplay.js` (jfSW's 48300 range is used by `con.js` here); nominal rate 30 tics a second.
11. **`make test-web` runs `netplay.js`** (about 45 minutes); the test pages are served a `config.js` with `allowSharewareNetGames: true` and never the default; the default is shown refused by `gate`.
12. **The "yields entered with data held back" check is counted from the hide to tic 1,450**, not over the whole run: the hide itself and `-testquit`'s 1.5 s linger loop (which sends and waits) are test artefacts (13 of 1,539 over the whole run, 0 of 240 between).
13. **Also in the page:** the harmless "The session is closed." rejection at the end of a WebTransport game is ignored as in jfSW 06b (found by the `wt` scenario; not in 02's page).
14. **`level-exit` stalls machines on purpose** (A1's `-teststall`, one game for D6 with a stalled slave and one for D5 with a stalled master and late joiner datagrams), so the browser games bite on the two A1 fixes as well.


**Play-test steps (Arch Linux)**

```
sudo pacman -S --needed base-devel git unzip python nodejs npm go sdl2 libvorbis libogg mesa glu alsa-lib gtk3
git clone --recurse-submodules -b browser/04-browser-netplay https://github.com/VenKamikaze/jfduke3d-browser
cd jfduke3d-browser
scripts/setup-emsdk.sh && scripts/build-wasm.sh      # about 3 minutes the first time
scripts/fetch-test-data.sh && make -j4               # the shareware data, and the native ./duke3d
cp testdata/duke3dshare.grp build-wasm/
printf "window.JFSW_CONFIG={testMode:true,relay:'',allowSharewareNetGames:true,data:{url:'duke3dshare.grp',size:11035779,crc32:'983ad923',revalidate:false}};\n" > build-wasm/config.js   # a LAN: the shareware gate open (D14), test mode on
(cd ext/vnet/relay && go build -o /tmp/vnet-relay ./cmd/vnet-relay)
/tmp/vnet-relay -udp 127.0.0.1:7777 -http 127.0.0.1:7778 -origins 127.0.0.1:8000 -v      # terminal 1
(cd build-wasm && python3 -m http.server 8000 --bind 127.0.0.1)                          # terminal 2
```

Host from a browser: open `http://127.0.0.1:8000/?test=1&args=-net%20-relay%20ws://127.0.0.1:7778/vnet%20-host-room%202%20--%20-v1%20-l1%20-c2`, click "Click to start" and read the room code from the DevTools console (`mmulti: room code ABC234 ...`). Join natively: `./duke3d -allowsharewarenet -net -relay 127.0.0.1:7777 -room ABC234 -- -v1 -l1 -c2`, or from a second browser window with `-room ABC234` in place of `-host-room 2`. The other way round: host natively (`-host-room 2`), join from the page.

Things only a person can check:
- **A tab that is really hidden.** With a native host and a browser guest playing, switch to another tab for a minute, then five minutes (Chrome's intensive throttling), and back. The native game must never wait more than a moment, and the guest's picture must be current when you return. Then host from the browser, hide that tab, and watch the native guest keep playing. (The wake callback does not use timers, so the throttling should not matter; only a real browser can say.)
- **A security monitor and a mirror with real hands.** E1L1: the monitors are in the rooms east of the start (the Tab map shows them); press Space in front of one, in a game with a second player whose tab is in the background; E1L1's two mirrors are in the bathrooms (shoot one with the RPG). Both screens must show the same game, and `OUT OF SYNC` must never appear in the log or on the host's console.
- **A level exit with a poor connection:** E1L1 to the exit switch with 100 to 200 ms of latency on one player (`sudo tc qdisc add dev lo root netem delay 60ms`; remove with `tc qdisc del dev lo root`): the game must stay in sync into E1L2 (D11).
- **The tests on your own machine:** `npm i playwright && npx playwright install chromium`, then `node tests/web/netplay.js --list` and `node tests/web/netplay.js ws hidden-slave draw-state` (about 5 minutes); `tests/net/test-nodraw.sh` and `tests/net/test-level-exit.sh` natively.


