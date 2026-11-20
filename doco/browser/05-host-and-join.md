# 05: Host and join from the game

## Goal

A player can host or join an online game without typing command-line arguments: from the page's address (an invite link), from Duke's own menus, from the console, or from the native startup window. Hosting a browser game shows a lobby with the room code, a copyable invite link and who has joined. The host can start with fewer players than slots ("Start now", Q3). Every way a network game can fail or end tells the player why in plain words, and a machine that vanishes in the middle of a game gives the others a message and an orderly end instead of a hang (L18, the rest). A hidden browser tab does not hold up the room at a level end.

After this brief, a person who opens the page can play online with a friend using only the page, the menus and a link.

This is jfSW's brief 05 ([`doco/browser/05-host-and-join.md`](https://github.com/VenKamikaze/jfsw-browser/blob/claude/doco/browser/05-host-and-join.md) in `jfsw-browser`, Outcome and fix round included: it is the template), redone for Duke. **The engine side is already in the jfbuild fork** at the pinned commit `5950d14`, the merge of jfSW's brief 05 there: the lobby (`mmulti_vnet_lobbyplayers()`, `_lobbyslots()`, `_lobbystarted()`, `_startnow()`, `_startpending()`, `_leave()`), "Start now" with the final player count in the master's answer to the slaves' pings, the notices (full, started, closed, leaving, left), the session id that tells a newcomer at a departed player's address from the player, `mmulti_vnet_silentms()` and `_tellleft()`. **No fork change is expected** (jfaudiolib, jfmact and vnet stay as they are). What is new is all game side and page side.

## Read first

- [`README.md`](README.md): D3 (host and join *restart* into a network game), D4, D5, D8, D9 (the lobby is an HTML overlay), D14 (the shareware network gate: every entry point asks `NetGameAllowed()`; the README says "hiding the menu and console Host/Join entries when it is off" is this brief's), Q3, Q5, "Working across repos", "Bugs found in the original game" (numbers for new bugs: **D21 and up**).
- [`PROMPT.md`](PROMPT.md) §0 and §7.
- [`code-facts.md`](code-facts.md): §2 (the netcode), §3 (set-up, `Startup()`'s wait), §4 (blocking loops, `dobonus`, `userack`), §8 (console and menus), §15, §19 (random numbers), §20 (04: the hidden pass), §21 (04b).
- The Outcomes of [01](01-native-relay.md), [04](04-browser-netplay.md) (the hidden pass, D11, `waitingfornewlevel`) and [04b](04b-lag-cuts.md) (`inbarrier`, the 127 nudge).
- [`bugs.md`](bugs.md): L18 (the rest) and D1 to D20.
- jfSW: `doco/browser/05-host-and-join.md`, `code-facts.md` §19, `building.md` §6.6, `src/netlobby.c` and `.h`, `src/menus.c` (Host/Join Online), `src/osdcmds.c`, `src/startgtk_game.c`, `web/jfsw.js`, `web/index.html`, `web/jfsw.css`, `tests/web/netplay.js` (the 05 scenarios), `tests/net/test-startwin.sh`, `test-rejoin.sh`, `test-errors.sh`.
- `jfbuild/include/mmulti_vnet.h` (the API this brief calls), `jfbuild/src/mmulti.c` (the lobby, the pings), and, in this repository, `src/game.c` (`Startup()`, `app_main`, the main loop, `domovethings()`' quit handling, `userack()`, `dobonus()`, `gameexit()`), `src/netgame.c`, `src/menues.c` (CRLF), `src/osdcmds.c` (**CRLF too**), `src/startgtk_game.c`, `src/config.c`, `web/`, `tests/web/netplay.js`, `tests/net/`.

## What jfSW's 05 needs from other briefs (checked)

- **02c (page errors) and 06b (WebTransport rejections):** Duke's page already has both (`gameError()`, `quietRefusal()`, the `vnet_wt_close` rule in the `unhandledrejection` handler were ported with 02 and 04). Nothing to port.
- **jfSW's 05's test mode** (`?test=1` needs `testMode: true` in `config.js`, `?relay=` removed): already in Duke's page and `tests/web/server.js` (`configText()`).
- **05b** (the data/build mismatch notice) and **06** (deployment) are separate Duke briefs and are not in this one: the invite link keeps `?data=` as jfSW's does and the notice's element is not added.

## Claims checked against Duke's code (jfSW's findings, one by one)

1. **The browser can start a network game today only on a `?test=1` page.** Same: `web/jfduke3d.js`' `gameArgs()` passes `-allowsharewarenet` (when `config.js` says so) and the test arguments; `config.js`' `relay` field is unused.
2. **Who has joined and the final count come from mmulti, not the relay.** Already done in the fork. The game's wait is `Startup()`'s loop (`src/game.c`: `while (initmultiplayerscycle()) { handleevents(); if (quitevent) ... }`), which this brief replaces by `NetLobbyWait()` for relay games (plain UDP waits exactly as before).
3. **"Start now" changes `numplayers` while the others wait.** Duke reads `numplayers` first after the wait (`getnames()`, `ud.multimode = numplayers`, `playerswhenstarted`), so every machine knows the final count before anything uses it. The fork does it; the tests prove it with `-testdump` for 2 of 3 and 2 of 4.
4. **A hidden guest holds up the room at a level end.** **Not like jfSW:** Duke's **co-op** `dobonus()` returns at once (`code-facts.md` §4), so a hidden tab is only held up by the **deathmatch** totals table (`FRAGBONUS:`, `userack()`), at every dukematch level end (`playerswhenstarted > 1 && ud.coop != 1`), and by the same table in `gameexit()`'s `dobonus(1)` and `newgame()`'s `dobonus(1)`. `userack()` also holds the shareware order screens (`showtwoscreens()`). The fix is in `userack()`, which ends only on a key or a mouse button.
5. **A guest that quits is not the end of the game in Duke.** jfSW ends the game for everyone ("player P left the game") whatever way a guest leaves. In Duke a **proper** quit is an input bit (26) that every machine sees in the same tic and takes the player out of the game (`domovethings()`: "X is history!", `numplayers--`), and the others play on; only the **master** leaving ends the game (`gameexit(" \nThe 'MASTER/First player' just quit...")`, whose text is stale: bugs.md D21). A guest that **vanishes** (machine off, tab closed, process killed) sends no quit, so the master waits for its input for ever: that is what `NetGoneCheck()` ends, as in jfSW.
6. **A master left alone does not answer newcomers.** After the last guest quits `numplayers` is 1, and mmulti's `getpacket()` returns at once for `numplayers < 2`, so a newcomer's ping at the departed guest's relay address is never answered (jfSW never has this case). It is never let in (nothing answers it); it sees "the host did not answer" after the 15 s the fork gives. With two or more players still in, the master's answer is "the game has already started". Recorded as bugs.md D22; a fix would be a fork change (not made).
7. **`menues.c` and `osdcmds.c` are CRLF**, like `player.c`, `sector.c` and `premap.c` (the task's list missed `osdcmds.c`). Every commit that touches them keeps CRLF (CR count equals line count).

## In scope

### A. Starting a network game from the page (browser)

As jfSW's A. `?host=N` and `?join=CODE` start a network game through the relay in `config.js`; the page builds `-net -relay URL -host-room N --` or `-room CODE --` itself (after `-allowsharewarenet`, which must come before `-net`: `code-facts.md` §15.1). They work on a normal page. N is 2 to 8 (the fork's relay room limit), **4 with the shareware data** (`res.game === 'DUKESW'`); CODE is six characters of the relay's alphabet in any case. A bad value, no relay in `config.js` (never from the address), or both parameters, say so on the page and start no game.

**Duke's D14 adds one rule:** with the shareware data and `allowSharewareNetGames` not true in `config.js`, `?host=` and `?join=` say the shareware network gate is closed (the game's own wording, `NetRefuseShareware()`) and start no game. The game's own gate stays as the authority.

### B. The lobby overlay (browser, D9)

As jfSW's B, the same HTML and CSS: room code, a copyable invite link (`?join=CODE` on this page, `?data=` kept), "N of M players are in", Start now for the host once 2 are in, Cancel; keyboard only works; phone width; the game's keyboard handler does not take the lobby's keys. The game pushes its state to the page (`Module.jfswLobby`, an `EM_JS` call from the wait loop, on every change and every 100 ms) and gets the player's requests back as the return value; nothing on the page calls into the wasm.

### C. "Start now" (Q3)

The fork's protocol, used by `NetLobbyWait()`. Natively, Start now is **a line `start` on the host's standard input** or the GTK startup window's Start button (the video mode is not set during the wait, so the console and the game window cannot be used). A line `cancel` leaves. Plain UDP is unchanged (`tests/net/test-udp-unchanged.sh`).

### D. Host and join from inside the game

- **Console** (`src/osdcmds.c`): `host [players]`, `join <code>`, and natively `relay [HOST:PORT]`. Both restart into a network game (D3): the browser reloads the page with `?host=N` / `?join=CODE`; natively the game leaves through `gameexit("")` and `execv`s itself (`/proc/self/exe` on Linux, `argv[0]` elsewhere, `_execv` on Windows: written, not built here) with `-net -relay <setting> -host-room N | -room CODE --` and its other arguments minus its own `-net` group. **Duke differs from jfSW in how it leaves:** jfSW sets `QuitFlag` and returns through `Control()`; Duke has no such return path (`gameexit()` calls `exit(0)` from anywhere, `Shutdown()` writes the config first), so `NetRelaunch()` is called at the end of `gameexit()`, just before `exit(0)`, and `NetRestart()` ends with `gameexit("")` (the empty string skips the shareware order screens and the deathmatch totals). (No change of directory is needed for the re-launch: `app_main` changes into `~/.jfduke3d` unless a `user_profiles_disabled` file is in the current directory, and the new process decides the same way; relative `-j`, `-g` and `-d` paths already break after that change in the original game, in the first process too.)
- **Menus** (`src/menues.c`): **"HOST ONLINE" and "JOIN ONLINE" in the main menu (menu 0), after QUIT**, where a single player picks a game (hot keys G and J: D4's "a hot key moves the cursor, Enter chooses"). Host leads to menu 1600, a list of player counts (2 to 4 on shareware, 2 to 8 otherwise); Join to menu 1610, which types the room code with the game's own `strget()` (the password menu's way) and says why a code is wrong. **The in-game menu (menu 50) has no such entries** (nine items would not fit the screen); a player in a single player game uses the console or "QUIT TO TITLE" first. The entries are **hidden** when a network game is on, a demo plays, or `NetGameAllowed()` is false (D14). Choosing one with no relay set says so in the console, which the game opens.
- **The console commands are not hidden under D14** (a missing command says "unknown", which tells nothing): they print the shareware gate's wording and do nothing. (A reading of the README's "hiding the console entries": the menu entries are the hidden ones.)
- **Native setting:** `[Comm Setup] Relay = HOST:PORT` in `duke3d.cfg`, set by the console's `relay`, the startup window's relay field, or a successful `-net -relay HOST:PORT` start. Placeholder hosts in docs (`relay.example.org`).
- **Native startup window** (GTK; `src/startgtk_game.c`, `rsrc/startgtk_game.glade`, the regenerated `rsrc/startgtk_game_gresource.c`, `src/startwin.h`): one check box "Online, through the relay:" with a relay field turns the existing join field into a room code and the existing player count into `-host-room`. The Windows window (`startwin_game.c`) and macOS (`StartupWinController.m`) are unchanged (not cheap without those builds). Test-only: `JFDUKE3D_TEST_STARTWIN="host=N relay=ADDR [startnow=K]"` or `"room=CODE relay=ADDR"` fills the window in as a person would, and `tests/net/test-startwin.sh` runs it under `xvfb-run`.

### E. Clear end and error states, and the vanished machine (L18, the rest)

Every failure says why on the page's overlay (browser: "Back to the start page" after a network game) or in a message box and the console and log (native, exit status 1): relay unreachable or not configured; bad or unknown room code; room full; game already started; host left during the wait; host left the game (**proper quit: Duke's own message path, reworded for relay games**; vanished: `NetGoneCheck()`); relay session lost (`NetLostCheck()`, kept); a guest left mid-game (**proper quit: the others play on, "X is history!"** as in the original; vanished: the master ends the game for everyone with the reason, as jfSW).

- **`NetGoneCheck()`** (new, `src/netlobby.c`, called at the end of `getpackets()`): in a relay game with 2 or more players in, every 250 ms: the master looks at each live guest with `mmulti_vnet_silentms()`, a slave at the master; more than `NET_GONE_MS` (15 s, the relay's session timeout) of silence ends the game with "player P (Name) left the game (their machine stopped answering N s ago)" (the master first tells the others with `mmulti_vnet_tellleft()`) or "the host left the game (...)". It does not duplicate `NetLostCheck()`, which keeps the relay-session-lost case (`mmulti_vnet_state() == FAILED`, nothing moved for 2 s) in the main loop and in `waitforeverybody()`. Plain UDP is not affected (`mmulti_vnet_active()` is false).
- **A host that quits properly** in a relay game: the slaves' `domovethings()` message says "The host ended the game." (relay games only; the stale text stays for plain UDP).

### F. The hidden guest at a level end

A hidden tab (`NetHiddenTab()`, which is `jfbuild_browser_hidden_netgame()` in the browser and `-testnodraw` natively, in a network game) leaves `userack()` at once, with a log line, so the deathmatch totals table (and the order screens) never hold it. Visible players behave as in the original game (they press a key; bugs.md L23's counterpart is not a Duke bug but the original game's behaviour). **Nothing drawing-dependent changes the simulation:** the machines leave the table at different moments but `dobonus()` and `userack()` write nothing the simulation reads (`code-facts.md` §20.3, §17); the next level's start is behind `enterlevel()`'s barrier (D5, D6, D11, `waitingfornewlevel`, `inbarrier` unchanged). Shown by test: the next level agrees on every tic.

## Out of scope

- Joining mid-game (D2), peer-to-peer over the relay (D5), any change to vnet or the relay, matchmaking, chat, accounts, the netcode and the hidden pass's stepping.
- **05b** (data and build warning) and **06** (deployment).
- The Windows and macOS startup windows, the Windows re-launch build, the in-game menu's entries.

## Acceptance criteria

1. In the browser, a player can host from the menu or the console, share the invite link, and have a second browser join from it and play, with no `?test=1` and no hand-typed arguments. The same works with a native host and a browser guest, and the other way round.
2. The lobby shows the room code, the invite link and who is in, and updates as players join. Cancel works for both host and guest.
3. "Start now" starts a 2-of-3 and a 2-of-4 game in which every machine agrees on every tic (including a renumbering after a Cancel). A late joiner is refused clearly.
4. Natively, `host` and `join` re-launch into a relay game. The startup window can host and join by code.
5. Every error state of E is reached by a test and shows its message. None hangs. A guest or host that vanishes ends the others' game within about 30 s with a message.
6. A hidden guest does not stall the room at a deathmatch level end, and the next level agrees on every tic.
7. `make test GAME_RUNS=1`, `netplay.js` (all scenarios), `smoke.js`, `persist.js`, `data.js` and strict `determinism.js` pass (the known 100 ms stall check excepted). Plain UDP `-net` is unchanged.
8. Docs: this Outcome, `code-facts.md` §22, `building.md`, `bugs.md` D21 and up, the README row ("review"). `PROMPT.md` is not edited.

## Tests

1. **`netplay.js`** (jfSW's scenarios with Duke's names; ports 48400 to 48499):
   - `lobby` (ordinary pages with the relay from `config.js`: `?host=3`, the code and invite link, the second browser from the link, the count, Start now by keyboard, a late third browser, Cancel for both, phone width);
   - `start-now` (2 of 3 two browsers; 2 of 4 native host, browser guest, a refused early `start`; browser host, native guest; late joiners refused);
   - `host-join` (console and menu: browser console host + native guest; native console host (re-launch) + browser guest from the link; browser host + native console join; browser menus host and join; all agree);
   - `lobby-errors` (no relay, bad counts and codes, shareware over 4, **the shareware gate closed**, also in the title menu and the console, relay unreachable, unknown room, full room, `testMode: false`; a vanished host and a vanished guest mid-game, browsers and native; the proper quits are in `test-gone.sh` and `rejoin-quit`);
   - `level-end` (deathmatch: a hidden browser guest at the totals table after `-testexit`, the visible host presses a key, the next level agrees; and a hidden host);
   - `rejoin-vanish`, `rejoin-quit` (the B1 cases; Duke's alone-host case: bugs.md D22), `compaction`.
2. **Native** (`tests/net/`): `test-startwin.sh` (xvfb; NOT RUN, exit 3, without it), `test-rejoin.sh`, `test-gone.sh` (a guest and a host killed mid-game: the others end with the message; proper quits), `test-hidden-bonus.sh` (two `-testnodraw` machines through a deathmatch level end, relay and UDP), `test-shareware-gate.sh` (the console's host and join ask the gate), `test-errors.sh` (it already expects the refusal: it was ported from jfSW's adapted one), `test-udp-unchanged.sh` unchanged and passing, `test-three-games.sh` unchanged.
3. **Mutations** (each applied, rebuilt, run, reverted; the fork's `mmulti.c` ones are scratch changes, **never committed**): "Start now" without telling the slaves the final count; an overlay that never updates the player count; the `userack()` fix removed; `NetGoneCheck()` removed; no session-id check; the shareware gate not asked by the menu or console; the hash change reverted (the owner of a player's gibs compared again).
4. **Regression:** `make test GAME_RUNS=1`, `netplay.js` (all), `make test-web` (including strict `determinism.js`; the known `frametime.js` 100 ms stall check may fail and is reported).

## Dependencies

04 and 04b (merged into `claude`), the jfbuild fork at `5950d14`. Brief 05b comes after.

## Notes

- Repos touched: jfduke3d-browser only. Branch `browser/05-host-and-join` from `origin/claude` `2eb459f`. If a fork change proves necessary, stop and write down why here first, then both games' `make test` must pass before the pin moves (none expected).
- Commit and push in stages (this brief, A+B the page, C+D the game, E, F, tests, docs). The State section below is the memory across a container restart.
- Line endings: `menues.c`, `osdcmds.c`, `player.c`, `sector.c`, `premap.c` are CRLF; check the CR count before each commit.
- The random-order rule (code-facts §19): no new `krand()` draw, no drawing or audio state in the simulation. This brief adds none.
- Ports and loads as 04: browser tests 48400 to 48499, native network tests 47400 and up, one test at a time under `flock /tmp/jfd-heavy-tests.lock`, `EMSDK_DIR=~/.cache/jfsw-browser/emsdk`.
- Commit trailers on browser commits: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01Cx2moAtxK78zTspjE2Gxak`.

## Outcome

Status: **review** (branch `browser/05-host-and-join` in jfduke3d-browser, from `claude` `2eb459f`). **No fork change**: jfbuild stays at `5950d14` (it has the lobby, Start now, the session ids and `mmulti_vnet_silentms()`; the two mutation runs that change its `mmulti.c` were scratch builds, never committed), jfaudiolib, jfmact and vnet are untouched, so jfSW's `make test` was not affected and was not run. **No game-breaking bug of the original game was found**: no `fix/` branch; `bugs.md` D21 to D23 (lesser, none planned) and updates to L18 and D8. Nothing was merged, no pull request was opened, `claude` and `master` were not touched. `PROMPT.md` is not edited.

**Commits** (in order): `ac09fb3` the brief; `c45af21` the page (A, B); `35f7cf8` the game (C, D, E, F: `netlobby.c`, the menus, the console, the startup window, `NetGoneCheck()`, `userack()`); `a3d174e` the native tests and the `netplay.js` scenarios, with the hash and hidden-tab changes they found; `9d995ba` more tests and the first docs; `6c5545c` the re-launch without a `chdir`; then the documentation and Outcome commits.

**What landed, per requirement** (jfSW's 05 point by point; what differs for Duke is in bold)

- *A. `?host=N` and `?join=CODE`* (`web/jfduke3d.js`): on any page, relay from `config.js` only, bad values, no relay, both parameters and **the shareware gate (D14) closed** said on the page before a game starts; N 2 to 8, **4 on shareware data** (`res.game === 'DUKESW'`); `-allowsharewarenet` goes before `-net`. `lobby-errors`: 15 page cases, each with its message, a button back to the start page, no page error.
- *B. The lobby overlay*: jfSW's HTML and CSS unchanged in substance; the game pushes its state (`Module.jfswLobby`), the page returns Start now and Cancel; keyboard only works (`lobby`: Tab to Start now, Enter, Cancel by Enter), 360 px wide window fits, the invite link keeps `?data=`.
- *C. Start now*: the fork's protocol through `NetLobbyWait()`; **it needed nothing else in Duke** (`numplayers` is first read after the wait). 2 of 3 (two browsers), 2 of 4 (native host by `start` on its input, browser guest; browser host, native guest), a Cancel renumbering (`compaction`: B moves down to player 2, C is player 3): every `-testdump` equal. A refused early `start` is not remembered. Late joiners (browser and native) are told "the game has already started" in 0.5 to 1.1 s.
- *D. Host and join from inside the game*: console `host [players]`, `join <code>`, `relay [HOST:PORT]`; **HOST ONLINE (G) and JOIN ONLINE (J) in the title menu only** (the in-game menu 50 would have nine items; menus 1600 and 1610, the room code typed with `strget()`); **the re-launch leaves through `gameexit("")` and `NetRelaunch()` at its end** (jfSW returns through `Control()`); the entries are hidden and the commands refuse under the shareware gate; the GTK startup window has an "Online, through the relay" box (`test-startwin.sh`, xvfb); `[Comm Setup] Relay` in `duke3d.cfg`.
- *E. Error states and L18 (the rest)*: `NetGoneCheck()` from `getpackets()`: a host or guest silent for 15 s ends the others' game with a message (15.2 s after the process died in `test-gone.sh`; 15.1 to 15.3 s for a vanished host or the host's view of a vanished guest and 17.4 s for another guest told by the host in `lobby-errors`). **A proper quit is not a vanish in Duke**: the guest is taken out ("X is history!") and the others play on (`guest-quit`, `rejoin-quit`: equal dumps to tic 1200); only the master's quit ends the game, and **relay games now say "The host ended the game"** (D21). The relay-lost, unreachable, unknown room, full room, started, host-left-the-room cases are the fork's messages, each reached by `lobby-errors` or `errors`.
- *F. The hidden guest at a level end*: **co-op has nothing to wait at in Duke; the deathmatch totals table (`userack()`) is it.** `userack()` returns at once for a hidden tab in a network game (`NetHiddenTab()`); visible players wait for their key as in the original. `test-hidden-bonus.sh` (two hidden natives, relay and UDP) and `level-end` (a hidden browser guest, then a hidden host, the visible one pressing Space): the next level's dump and state agree.

**Decisions** (the conservative option, closest to jfSW)

1. **No fork change; no `QuitFlag`.** Duke's loop is inline and everything ends in `gameexit()`, so the re-launch is called at the end of it.
2. **Menu entries after QUIT in the title menu only** (jfSW's layout; menu 50 has no room). Hot keys G and J.
3. **Console commands are not hidden under D14** (they refuse with the gate's wording); the menu entries are (the README said "hiding the menu and console entries").
4. **`-testnodraw` stays hidden after the others have left** (`playerswhenstarted > 1`), and the tests' quitters run it: a game that ends on shareware data shows two order screens that wait for a key (D23).
5. **The owner of a player's gibs is out of the state hash** (`IsLocalGib()`), as a monitor's owner is (D18): a guest's proper quit gibs its player with `myconnectindex` as owner (D8), which made every sprite of the gibs differ between machines and `-testsync` report 96 mismatches with nothing wrong in the game. Reverting it fails `test-rejoin.sh` and `test-gone.sh guest-quit`.
6. **No `chdir` back before the re-launch** (my first version restored the starting directory; the test for it showed the original game cannot use a relative `-j` path after its own `chdir` in the first process either, so it changes nothing).
7. `NetOnlineAvailable()` caches the gate (the menu asks it every frame, and for registered data it is a file lookup).
8. The relay's `?relay=` knob stays gone and test mode needs both `?test=1` and `testMode: true` (already so from 03/04; `lobby-errors` checks it).

**Results** (final code; one test at a time under `flock`; headless Chromium is software-rendered on 4 shared cores, load average 1 to 5)

| Test | Checks | What it shows |
|---|---|---|
| `netplay.js lobby` | 27 / 0 | ordinary pages, relay from `config.js`: room code, invite link, count 1 then 2 of 3, Start now by Tab and Enter, a third browser refused in 0.7 s and offered the start page, a 360 px window fits, Cancel for a guest (0.3 s, place free again) and for the host (the guest told within 0.3 s), no page errors |
| `netplay.js start-now` | 78 / 0 | 2 of 3 (two browsers), 2 of 4 (native host by `start` on its input, early `start` refused and not remembered; browser guest), 2 of 4 (browser host, native guest): every machine started with 2 players as player 1 and 2, 400 tics, dumps equal; late browser and native joiners refused in 1.1 and 0.5 s |
| `netplay.js host-join` | 92 / 0 | browser console `host 2` + native guest; native console `host 2` (re-launch with `-allowsharewarenet -net -relay R -host-room 2 --`) + browser guest from the link; browser host + native console `join` (re-launch); **browser menus: HOST ONLINE (menu 1600), JOIN ONLINE (menu 1610) with a wrong code refused in the menu, then the right one; the host starts the game from NEW GAME (menu 600)**: every game 400 tics, equal dumps |
| `netplay.js lobby-errors` | 101 / 0 | 15 page cases (no relay, `?relay=` ignored, bad counts and codes, 5 on shareware, both parameters, unknown room, full room, relay unreachable, **the shareware gate closed for `?host=` and `?join=`, the title menu and the console**, `testMode: false`); a vanished host (browser guest 15.3 s, native guest 15.1 s), a vanished guest of 3 (the host 15.3 s, the other guest 17.4 s; browsers, and a native host with browser guests): status 1, the message, the overlay with "Back to the start page" |
| `netplay.js level-end` | 64 / 0 | a dukematch ending at tic 200 (`-testexit`), a hidden browser guest, then a hidden host: the hidden one leaves the totals table by itself, the visible one's player presses Space, 200 + 300 tics on every machine, equal dumps and equal state at the next level's tics 1, 2 and 300 |
| `netplay.js rejoin-vanish` | 9 / 0 | a guest's tab closes: the newcomer gets 10.0.0.2 and is refused in about 1 s; the host ends with "player 2 left" after 15.2 s |
| `netplay.js rejoin-quit` | 14 / 0 | native host, browser guest (hidden) quits at tic 200, native guest: the newcomer is refused in 1.3 s, the other two play to tic 1200 with equal dumps and "is history" in their logs |
| `netplay.js compaction` | 34 / 0 | a Cancel renumbering, then Start now with 3: B is player 2, C player 3, equal dumps |
| `tests/net/test-startwin.sh` | 17 | the GTK window under xvfb-run: host 3, Start now at 2, a joiner by code typed in lower case, 300 tics, equal dumps, the relay kept in `duke3d.cfg`; Online with Join and no code says so and starts nothing |
| `tests/net/test-rejoin.sh` | 21 | vanish (15.2 s), a quit in a game of 3 (the newcomer refused, the others agree to tic 1200), a quit alone (D22) |
| `tests/net/test-gone.sh` | 15 | host gone 15.2 s, guest of 3 gone (15.2 s and 17.2 s), host quit ("The host ended the game", status 0), guest quit (to tic 600, equal dumps) |
| `tests/net/test-hidden-bonus.sh` | 21 | two hidden natives through a dukematch level end, relay and UDP: both leave the table by themselves, 500 equal records |
| `tests/net/test-shareware-gate.sh` | 41 | the old cases and the console's `host` and `join` refused with the licence reason, nothing re-launched |

**Regression** (final code, rebuilt native and wasm from clean libraries after the mutation runs)

- `make test GAME_RUNS=1`: **exit 0, 26 PASS** (the 22 of 04b and the four new native tests: gone, rejoin, hidden-bonus, startwin; 870 `ok` lines, no NOT RUN), 25 minutes. It includes `test-udp-unchanged.sh` (plain UDP against the pre-brief-01 build, unchanged), `test-three-games.sh` (relay and UDP, `-f2`, `-f4`), `test-level-exit.sh`, `test-save.sh`, `test-errors.sh`, `test-relay-lost.sh`, `test-shareware-gate.sh` and `krand-order.py`.
- `make test-web` (it stopped at `netplay.js`'s failure, so `determinism.js` and `frametime.js` were run by hand afterwards): `grptable.js` 12/0, `data.js` 193/0, `con.js` 17/0, `smoke.js` 36/0, `persist.js` 18/0, `focus.js` 24/0, `menu-keys.js` 23/0, `loops.js` 18/0, **`netplay.js` (every scenario: 04's, 04b's and the eight new ones; 55 minutes) 1,602 passed, 5 failed: all five in `lag-highlat`'s 400 ms case with a browser slave**, **`determinism.js` strict 22 passed, 0 failed**, `frametime.js` 3 passed, **1 failed: the known "no stall over 100 ms" check** (max 191 ms, p99 108 ms, load 3.6).
- **`lag-highlat` is not caused by this brief.** It is marginal in this container today (the original game's 256 byte datagram limit, bugs.md D20): three more runs of the 05 build gave 19/9, 26/4 and 19/9 (the slave ends at tic 318 to 340 of 350), and **three runs of the 04b build (`/home/user/wt-d04b`, no 05 code) gave 19/9, 19/9 and 25/5**, the slave there hanging until the time limit (125 s). The 05 build ends such a slave after 15 s with "the host left the game", which is `NetGoneCheck()` turning a hang into a message. 04b's Outcome had it passing (32 checks) under a lighter load.



**Mutations** (each applied, built, run, reverted; the fork's `mmulti.c` ones are scratch changes, never committed; `/home/user/d05-variants/mutate.sh` and `runmut.sh`, logs `mut-*.log` and `mut2-*.log`). A first run of the fork mutations was invalid and was redone: the top-level `make` reuses an existing `jfbuild/libengine*.a` (bugs.md L9), so the mutated `mmulti.c` was not built in, and the tests find the guest to kill by the process name `duke3d`, which a variant binary named otherwise does not have; the variants now sit in `NAME/duke3d` and the engine libraries are removed before each fork build and before the restore. The three game-side mutations that the browser tests needed were built together (`web3`: the `userack()` change off, `NetGoneCheck()` off, the gate not asked) because the tests that bite on them are independent: `level-end` only reacts to the first, the gone cases and `gate-menu` to the others.

| Mutation | Run | What failed |
|---|---|---|
| `userack()`: no exit for a hidden tab | `test-hidden-bonus.sh` | 10 checks: all four machines hang at the totals table (exit 124), no record of the next level |
| the same, wasm | `netplay.js level-end` (`web3`) | 28 failed, 30 passed: the visible player presses Space, the hidden guest never leaves the table, neither machine reaches the next level |
| `NetGoneCheck()` does nothing | `test-gone.sh host-gone guest-gone` | 7 checks: the survivors are still running 51 s and 108 s after the process died, no message |
| the same (and the gate), wasm | `netplay.js lobby-errors` (`web3`) | 24 failed, 77 passed: the four gone games hang to the test's limit (22 checks) |
| the menu and the console do not ask the shareware gate | `test-shareware-gate.sh` | 2: the console's `host` and `join` re-launch the game (exit 1 of the test's game) |
| the same, wasm | `netplay.js lobby-errors` (`web3`) | 2 of the 24: `gate-menu`: HOST ONLINE opens menu 1600, the console's `host` does not say the gate is closed |
| no session id check (fork) | `test-rejoin.sh` | 5: the newcomer at the vanished guest's address is not refused (20.9 s, no message), the host ends 40 s after the guest died, the newcomer after a quit is refused after 15.2 s with another message |
| "Start now" tells the slaves the original count (fork) | `netplay.js start-now` (wasm and native variants) | 10 failed, 12 passed: the first game (2 of 3) ends with "player 2 left the game" on the master, neither machine plays (the page crashed in the run) |
| the overlay's count never goes up | `netplay.js lobby` (page only) | 7 failed, 10 passed: "2 of 3" never shown, Start now never offered, no game |
| the gib owner hashed again | `test-rejoin.sh`, `test-gone.sh guest-quit` | 1 and 1: the host and the other guest differ from tic 203 (D8) |



**Not done, or only partly**

- Windows: the re-launch's `_execv` quoting is written (with the bound fixed that jfSW's review noted) but not built or run; the Windows and macOS startup windows have no online choice; the Xcode project does not list `netgame.c` or `netlobby.c` (it did not list `netgame.c` before). `start` on the standard input is the native Start now there.
- Firefox, Safari, a real GPU, a real network, a registered GRP, a person playing; a tab that is really hidden at the totals table (Playwright cannot hide one: the imitation is as in 04).
- Plain UDP has no silence clock: `NetGoneCheck()` is relay-only (the L18 row says so).
- A deathmatch totals table is tested only through `-testexit`; the same table in `gameexit()`'s and `newgame()`'s `dobonus(1)` is the same `userack()`.
- The shareware order screens (D23) still wait for a key for a visible player at the end of a game.

**Follow-ups** (none needed for this brief)

- jfSW's 02c page-error fixes and 06b's WebTransport rejection rule were prerequisites of its 05 page code; Duke's page had both from 02 and 04: nothing to port. jfSW's 05b notice (`#notice`, `jfswNotice`) and 06 (deployment, `deploy.md`, `check-deploy.sh`) are the next two Duke briefs.
- `config.js`'s `relay` must be set for the page's host/join (brief 06's deployment guide), and the relay's `-origins` must name the page's origin.
- D22 (a master left alone answers nobody and loses its relay session) would be a fork change (shared with jfSW); D20 (the 256 byte datagram) is still open.

**Play-test steps (Arch Linux)**

```
sudo pacman -S --needed base-devel git unzip python nodejs npm go sdl2 libvorbis libogg mesa glu alsa-lib gtk3
git clone --recurse-submodules -b browser/05-host-and-join https://github.com/VenKamikaze/jfduke3d-browser
cd jfduke3d-browser
scripts/setup-emsdk.sh && scripts/build-wasm.sh && scripts/fetch-test-data.sh && make -j4
cp testdata/duke3dshare.grp build-wasm/
(cd ext/vnet/relay && go build -o /tmp/vnet-relay ./cmd/vnet-relay)
/tmp/vnet-relay -udp 127.0.0.1:7777 -http 127.0.0.1:7778 -origins 127.0.0.1:8000 -v                                   # terminal 1
sed -i "s|relay: ''|relay: 'ws://127.0.0.1:7778/vnet'|; s|allowSharewareNetGames: false|allowSharewareNetGames: true|" build-wasm/config.js   # a LAN: gate open
(cd build-wasm && python3 -m http.server 8000 --bind 127.0.0.1)                                                       # terminal 2
```

(For another machine on the LAN use this machine's LAN address instead of 127.0.0.1 in all four places and open the page by it.)

1. **Host in one browser, join from the link in another.** Open `http://127.0.0.1:8000/?host=3`, click "Click to host a game of 3". The lobby shows a room code, an invite link (Copy) and "1 of 3 players are in". Paste the link into a second window: both say "2 of 3". Tab moves through Copy, Start now and Cancel; narrow the window to phone width and nothing is cut off. Press **Start now**: both lobbies go and the game starts in the title screens; skip the logo with a key. **On the host: NEW GAME, set the game type to co-op, START GAME**, and play a minute. Open the link in a third window: "the game has already started".
2. **Cancel.** `?host=2`, join from the link, Cancel on the guest (the host's count drops at once), join again, Cancel on the host (the guest is told at once).
3. **From the title menu and the console.** On `http://127.0.0.1:8000/` skip the logo: the menu has **HOST ONLINE** and **JOIN ONLINE** after QUIT (keys G and J). Host with "2 PLAYERS"; in another window JOIN ONLINE, type the code, Enter (a wrong code says so and stays). Also the console (Num Lock): `host 2`, `join CODE`.
4. **Natively.** `./duke3d -setup` ("Online, through the relay", relay `127.0.0.1:7777`, host 3, Start) or, in a game, the console: `relay 127.0.0.1:7777`, then `host 3`: the game closes and starts again into the lobby; type `start` and Enter in its terminal with 2 in. Join from a browser with `?join=CODE`.
5. **A machine that vanishes.** In a game of 2 close the guest's tab (or `kill -9` the native game): the host's game ends about 15 seconds later with "player 2 (...) left the game". Close the host's tab: the guest ends with "the host left the game". A guest that quits properly (menu, Quit) is taken out and the others play on.
6. **A hidden guest at a level end.** Host and join (`?host=2`), start a **deathmatch** (game type "dukematch (spawn)"), play to the exit switch of E1L1, switch the guest's browser to another tab or minimise it before that. On the host press a key at the totals table: the next level must start within a few seconds (it used to wait for the hidden guest's key). Show the guest's tab: it is in E1L2.
7. **The tests on your machine**, one at a time: `node tests/web/netplay.js lobby start-now host-join lobby-errors level-end rejoin-vanish rejoin-quit compaction`, `tests/net/test-startwin.sh` (needs `xorg-server-xvfb`), `tests/net/test-rejoin.sh`, `tests/net/test-gone.sh`, `tests/net/test-hidden-bonus.sh`.

### Fix round (independent review of `16ef19f`)

1. **The native re-launch brought the startup window back (should-fix, reproduced).** `ForceSetup` defaults to 1, so a default install opens the window unless `-nosetup` is given; `NetRestart()` copied the old arguments without it, the room was made (`initmultiplayersparms()` runs before the window) and the game then sat at a window whose online choices are ignored when `-net` is given. Fixed: the re-launch carries **`-nosetup`**, once, before `-net` (a `-setup`/`-nosetup` of the old arguments is dropped). New `tests/net/test-relaunch-setup.sh` (Xvfb and xdotool, else NOT RUN; in `make test-net`): `ForceSetup = 1` in the cfg, no `-nosetup`, `JFDUKE3D_TEST_STARTWIN=go` presses the window's Start; console `host 2`, console `join CODE` and the title menu (G, Enter, 2, Enter via xdotool) must each show exactly one "TEST: startup window" and the new room or join. PASS 12 checks; **without the `-nosetup` 6 fail** (two windows, no `-nosetup` in the "Re-launching:" line). The GTK Online option starts a network game in process (no re-launch): `test-startwin.sh`. jfSW has the same re-launch (not changed here).
2. **`lag-highlat` did not discriminate; reshaped.** Measured on the current code (quiet machine, under `flock`): natives 500 ms with `-testsync` 2 of 5 complete, without `-testsync` 5 of 5; native + browser 400 ms 0 of 4 (316 to 344 of 350), at 300 ms 5 of 5. The host quits at `-testquit350` and leaves a lagging slave behind (D20's margin; `-testsync` makes packets bigger, a browser slave lags more). The scenario is now natives 500 ms and a browser slave at 300 ms, both without `-testsync` (`NETPLAY_HIGHLAT="nn:500:350:0,nb:300:350:0"` overrides the cases): **6 of 6 on the current code**; **with the nudge fix removed (`masterfwdsincetick` ignored) 3 of 3 fail**: the native slave ends at 293, 294 and 306 of 350 (285 to 307 in the earlier shapes), the browser case also failed in 2 of the 3. 04b's Outcome is corrected by a note there.
3. **Nits.** Menu 1610: "that is not a room code" goes at the next edit (`joinerrlen`). `NetRelaunch()` strips a " (deleted)" suffix of `/proc/self/exe` with a message. The gresource rules depend on the glade file as well (the regenerated `startgtk_game_gresource.c` is byte-identical). Line references in `code-facts.md` re-checked (`NetGoneCheck()` `netlobby.c:540`, `NetRelaunch()` `:405`, `userack()` `game.c:10313`); `bugs.md` L18 cites §22.2.

@@FIXREG@@

## State

**20 Nov 2026: finished, status review.** Everything in the Outcome is done and pushed (`browser/05-host-and-join`). Worktree `/home/user/wt-d05` (kept). Logs and scratch (not in git): `/home/user/d05-logs/`, `/home/user/d05-variants/` (mutated builds, `mutate.sh`, `runmut.sh`, `regress.sh`).

- [x] 0 to 5. The brief, the page, the game, `NetGoneCheck()` and the hidden `userack()`, the native tests, the `netplay.js` scenarios.
- [x] 5b. Mutations: all ten run and listed in the Outcome (the first run of the fork mutations was invalid and was redone, see there).
- [x] 6. Regression: `make test GAME_RUNS=1` exit 0 (26 PASS); `make test-web` and `determinism.js` strict 22/0; `netplay.js` 1,602/5 (`lag-highlat`, equally failing on the 04b build); `frametime.js`'s known stall check.
- [x] 7. Docs: Outcome, `code-facts.md` section 22, `building.md` section 9, `bugs.md` D21 to D23 (and L18, D8), the README row (review) and D14 text.
- [x] 8. Report.

**To do (the coordinator):** review; merge `--no-ff` into `claude` (no fork change); update `PROMPT.md` section 0.

**Open problems:** none new. Known and reported: `frametime.js`'s 100 ms stall check; `lag-highlat` marginal at 400 to 500 ms (D20); D22 (a master left alone); D23 (the order screens).
