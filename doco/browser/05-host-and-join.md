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
4. **A hidden guest holds up the room at a level end.** **Not like jfSW:** Duke's **co-op** `dobonus()` returns at once (`code-facts.md` §4), so a hidden tab is only held up by the **deathmatch** totals table (`FRAGBONUS:`, `userack()`), at every dukematch level end (`playerswhenstarted > 1 && ud.coop != 1`), and by the same table in `gameexit()`'s `dobonus(1)` and `newgame()`'s `dobonus(1)`. `userack()` also holds the shareware order screens (`showtwoscreens()`). The fix is in `userack()`, which has no `getpackets()`-independent exit.
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

- **Console** (`src/osdcmds.c`): `host [players]`, `join <code>`, and natively `relay [HOST:PORT]`. Both restart into a network game (D3): the browser reloads the page with `?host=N` / `?join=CODE`; natively the game leaves through `gameexit("")` and `execv`s itself (`/proc/self/exe` on Linux, `argv[0]` elsewhere, `_execv` on Windows: written, not built here) with `-net -relay <setting> -host-room N | -room CODE --` and its other arguments minus its own `-net` group. **Duke differs from jfSW in how it leaves:** jfSW sets `QuitFlag` and returns through `Control()`; Duke has no such return path (`gameexit()` calls `exit(0)` from anywhere, `Shutdown()` writes the config first), so `NetRelaunch()` is called at the end of `gameexit()`, just before `exit(0)`, and `NetRestart()` ends with `gameexit("")` (the empty string skips the shareware order screens and the deathmatch totals). The re-launch also returns to the directory the game was started in (`app_main` changes into `~/.jfduke3d`), so relative arguments such as `-g file.grp` still work.
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
   - `lobby-errors` (no relay, bad counts and codes, shareware over 4, **the shareware gate closed**, relay unreachable, unknown room, full room, `testMode: false`; a vanished host, a vanished guest and a proper guest quit mid-game);
   - `level-end` (deathmatch: a hidden browser guest at the totals table after `-testexit`, the visible host presses a key, the next level agrees; and a hidden host);
   - `rejoin-vanish`, `rejoin-quit` (the B1 cases; Duke's alone-host case: bugs.md D22), `compaction`.
2. **Native** (`tests/net/`): `test-startwin.sh` (xvfb), `test-rejoin.sh`, `test-gone.sh` (a guest and a host killed mid-game: the others end with the message), `test-hidden-bonus.sh` (two `-testnodraw` machines through a deathmatch level end, relay and UDP), `test-errors.sh` adapted where it expected the old silence, `test-udp-unchanged.sh` unchanged and passing, `test-three-games.sh` unchanged.
3. **Mutations** (each applied, rebuilt, run, reverted): "Start now" without telling the slaves the final count (the fork's `mmulti.c`, scratch copy, **not committed**); an overlay that never updates the player count; the `userack()` fix removed; `NetGoneCheck()` removed; no session-id check (fork scratch copy); the shareware gate not asked by the menu or console; the relaunch without the original directory.
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

(To be written when the work is done.)

## State

**Written 20 Nov 2026; nothing implemented yet.** Worktree `/home/user/wt-d05` (branch `browser/05-host-and-join`, from `origin/claude` `2eb459f`; kept). Logs and scratch: `/home/user/d05-logs/`, `/home/user/d05-variants/` (not in git). Build: native `make -j4` (done once), wasm `EMSDK_DIR=~/.cache/jfsw-browser/emsdk scripts/build-wasm.sh`; the test GRP is copied from `/home/user/wt-d04b/testdata/`.

Remaining work, in order (tick as done):

- [ ] 0. This brief, committed and pushed.
- [ ] 1. Page (A, B): `web/jfduke3d.js` (`?host=`, `?join=`, lobby, `Module.jfswLobby`, `Module.jfswNetGame`, the end overlay's button), `web/index.html`, `web/jfduke3d.css`, `web/config.js` comments.
- [ ] 2. Game (C, D): `src/netlobby.c`/`.h` (`NetLobbyWait`, `NetRestart`, `NetRelaunch`, `NetStartwinArgs`, `NetIsRoomCode`), `Startup()`, `app_main`, `gameexit()`, `config.c` (`Relay`), Makefiles, `osdcmds.c` (CRLF), `menues.c` (CRLF), startup window, `run-headless.sh` stdin, `-testosd`.
- [ ] 3. E and F: `NetGoneCheck()`, the host's quit message, `userack()`.
- [ ] 4. Native tests: `test-startwin.sh`, `test-rejoin.sh`, `test-gone.sh`, `test-hidden-bonus.sh`, `test-errors.sh`; mutations.
- [ ] 5. Browser tests: `netplay.js` scenarios; mutations.
- [ ] 6. Regression: `make test GAME_RUNS=1`, `netplay.js` (all), `make test-web`.
- [ ] 7. Docs: Outcome, `code-facts.md` §22, `building.md`, `bugs.md` D21+, README row to "review".
- [ ] 8. Report.
