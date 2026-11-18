# F-D3: F4 in a game leaves it in a menu that is not drawn and that Escape does not close (D3)

## Goal

F4 in a game opens the sound menu, the player can change the sounds, and Escape gets the player back into the game, in the native build and in the browser. The fix is small and upstream-friendly, on a branch from `master`, and goes into `claude` through an integration branch. A browser test (`tests/web/menu-keys.js`) and a native one (`tests/net/test-menu-f4.sh`) fail without the fix.

Found in brief 02 (browser) and confirmed natively at the merge of brief 01 (`bugs.md` D3). Game-breaking: any player who presses F4 is stuck (the game is paused, nothing is drawn, nothing answers), in single player and in a network game (there the others play on and the player's own screen is frozen on a menu state that the player cannot leave).

## Scope

1. **The fix, on `fix/f4-sound-menu` from `master`** (`55c5f95`), `src/menues.c` only: give menu 701 the code of the sound menu, and make Escape in it return to the game.
2. Find out why 701 is there, whether anything else refers to it, how the sound menu is reached from Options, and what the other F-key menus do on Escape.
3. Look at the neighbouring F-key handlers (F2, F3, F6 and the rest) for the same mistake.
4. **Integration branch `browser/F-D3-f4-menu` from `claude`**: merge the fix with `--no-ff`; add `-testmenu` (`src/testhooks.c`), `tests/web/menu-keys.js` (in `make test-web`), `tests/net/test-menu-f4.sh` (in `make test-net`), this brief and the `bugs.md` rows.

## Out of scope

- D4 (menu hotkeys move the cursor and do not choose): a different mechanism, see Findings.
- Sending anything upstream (no pull request, no issue).

## Findings

**The cause.** `nonsharedkeys()` in `game.c` (the F4 handler, around line 6730) does `cmenu(701)`. `cmenu()` only stores the number (`current_menu = 701`; `probey = 0`) and the key handler has already set `MODE_MENU`. `menus()` switches on `current_menu`, and it has `case 700` (the sound menu) but no `case 701` and no `default`, so nothing is drawn, nothing reads the keys, and nothing ever clears `MODE_MENU`: Escape is read by `probe()` inside the menu's own case, which is never reached. With one player the game is also paused (`ready2send = 0`, which F4 sets as the other F-keys do), so the player does not move either.

**The history of 701.** None is available. `master` is a single commit (`55c5f95`, "fix incorrect GRPs list traversal in macOS startup window"), so `git log -S'701'` and `-S'case 700'` find only that commit. `jonof/jfduke3d`'s `HEAD` is still `55c5f95` (`git ls-remote`, 18 Nov 2026), so there is no newer commit and no fix there. Upstream's open pull requests were not checked (no access through the GitHub tools; the coordinator can). 701 is used in one place only (`game.c`, F4); no menu "returns to" it, and `probe` and `cmenu` have no special case for it (`cmenu()` treats it like any number: `probey = 0`). Nothing else in the code compares `current_menu` with 700 or 701 (`game.c:1712` looks at 400 to 405, `game.c:2503` at under 51). So 701 reads as "the sound menu opened from the game, not from Options": in the DOS original F4 opened the sound menu too, but whether it was a separate number there cannot be told from here.

**How the sound menu is reached.** Escape (menu 50, the game's menu) or, outside a game, the main menu; Options (200); item 2, "Sound options" (`case 1: cmenu(700)`, `menues.c:2295`). In Options, Escape goes to the game's menu 50 (in a game) or the main menu 0; in menu 700, Escape goes to Options (`cmenu(200)`, with the cursor on Sound).

**What the other F-key menus do on Escape.** F2 (save, 350) and F3 (load, 300) close the menu and resume the game (`case 300`'s `case -1` in `menus()`: `ps[myconnectindex].gm &= ~MODE_MENU` (the save menus set `gm = MODE_GAME`) and, in single player and not in demo playback, `ready2send = 1; totalclock = ototalclock`); F6 (quick save slot, 360 to 369) the same. The game menu 50 (Escape in a game) does the same on Escape (its `case -1`). So an F-key menu returns to the game, not to Options.

**The fix.** `case 701:` shares `case 700:`'s code, and its Escape (`case -1`) does what F3's does: clears `MODE_MENU` and, in single player and not in demo playback, sets `ready2send = 1` and `totalclock = ototalclock` so the game resumes without catching up on the time spent in the menu. 700 is unchanged (Escape goes to Options). 11 lines added to `src/menues.c`, which is CRLF: the new lines are CRLF too.

- **Pausing.** Unchanged: F4's own handler pauses a single player game (`ready2send = 0`) and not a network game; Escape resumes in the same two cases.
- **Sound off.** F4 only works when `FXDevice >= 0` (the condition is in `game.c`), that is, a sound card is initialised; with sound unavailable F4 does nothing. With sound merely switched off in the menu (`SoundToggle = 0`) F4 opens the menu so it can be switched on again. The menu's own lines are greyed for `FXDevice < 0`, as in Options.
- **The other F-key handlers.** F1 (help), F2, F3, F5 (music name), F6, F7 (view), F8 (messages), F9 (quick load), F10 (quit), F11 (gamma) and F12 (screenshot), in `nonsharedkeys()` and the code around it in `game.c`: every `cmenu(N)` and `current_menu = N` in `game.c` (350, 300, 360 + slot, 15001, 25000, 500, 50, 0) has a `case N` in `menus()`. F4's 701 is the only one without.

**D4 (menu hotkeys move the cursor and do not choose).** Explained, not the same cause, and not fixed here. `probekeys()` (`menues.c:684-760`) maps a hotkey to its row by `probey = k`, plays the "chosen" sound (`PISTOL_BODYHIT`) and returns "no choice yet" (`-probey-2`), so the cursor moves and Enter is still needed. It is written that way on purpose (the comment says "to be mapped to probey values"); it is not an oversight of the kind D3 is. The browser test relies on it (O then Enter reaches Options; S then Enter reaches Sound) and passes, which is the confirmation in the browser. Whether the original 1.3D chose the item at once is still not known here, so D4 stays open as a possible difference from the original.

## Acceptance criteria

1. F4 in a game: the sound menu is drawn and takes keys; Escape closes it, the game goes on, the player moves. Native and browser.
2. The menu reached through Options (700) is unchanged: Escape goes to Options, then the game's menu, then the game.
3. The tests fail on a build without the fix and pass with it.
4. `fix/f4-sound-menu` has one commit, only `src/menues.c`, CRLF kept, a message for upstream, only the `Co-Authored-By: Claude Opus 5.5` trailer, and cherry-picks onto `master`.
5. The browser tests `smoke`, `focus`, `persist` and `loops` and the native `make test` still pass; `menues.c`'s browser change (`menuwasopen`, the config written when a menu closes) still works with F4.

## Tests

- **`tests/web/menu-keys.js`** (Chromium, port 49107, about 30 s; in `make test-web`). `-testmenu` makes the game print `TEST: menu N` whenever the menu of a game opens, changes or closes (`TestMenuPoll()`, from `displayrest()`; inert without the argument). Two rounds of F4 then Escape, each checking: the game reports 701; the sound menu is on the picture (red pixels where its names are: about 8,300, none on the level); frames keep coming; Escape gives -1; the text is gone; holding Up changes tens of thousands of pixels again. Then Enter on the Sound line changes ON to OFF in the picture (the menu takes keys). Then the Options path (Escape, O, Enter, S, Enter) reaches 700 and Escape goes 200, 50, none, and the player can move at the end.
- **`tests/net/test-menu-f4.sh`** (the native build on Xvfb, real keys from `xdotool`, screenshots from `import`, about 40 s; in `make test-net`): the same, two rounds. It says SKIP and passes when Xvfb, xdotool, ImageMagick or PIL is missing.
- Mutation: see the Outcome.

## Dependencies

Brief 02 (the browser build and its test library), brief 01 (`testhooks.c`).

## Outcome

Status: **review** (branch `browser/F-D3-f4-menu`; the coordinator marks it done after review and merge).

**Commits.**

- `fix/f4-sound-menu` (pushed): `0ba42f5`, one commit from `master` `55c5f95`, only `src/menues.c` (11 insertions), still CRLF on every line (`file`: "with CRLF line terminators", 4,550 lines and 4,550 CRs, as before plus the 11 new lines), trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` only. It is made on `master`, so it applies to it as it stands. Upstream `HEAD` is still `55c5f95` (`git ls-remote`, 18 Nov 2026).
- `browser/F-D3-f4-menu` (pushed): the `--no-ff` merge of the fix into `claude` (`menues.c` keeps the 12-line `menuwasopen` change: the config is written when the menu is left, F4's menu included: the test's Escape closes it and the game goes on), and the commit with `-testmenu`, the two tests, `make test-web` and `make test-net`, `building.md`, `bugs.md` and this brief. `git log` has the SHAs.

**The fix.** See Findings. `case 701:` shares `case 700:`'s code; in its `case -1`, a menu opened by F4 (701) clears `MODE_MENU` and resumes the game (`ready2send = 1; totalclock = ototalclock` in single player and not in demo playback) instead of going on to Options.

**What Escape does now.** From the sound menu opened by F4: back into the game. From the one reached through Options: unchanged, Escape goes to Options, then the game's menu, then the game (tested).

**`-testmenu`** (new, `src/testhooks.c`, `src/game.c`: two lines and the argument): `TestMenuPoll()` from `displayrest()` prints `TEST: menu N` when the menu of a game changes (N = `current_menu` while `MODE_MENU` is set, -1 otherwise). It does nothing without the argument.

**Tests, with the fix.** All run under `flock /tmp/jfd-heavy-tests.lock`.

| Test | Result |
|---|---|
| `tests/web/menu-keys.js` (new) | 23 passed, 0 failed (about 30 s) |
| `tests/net/test-menu-f4.sh` (new, native, Xvfb and xdotool) | PASS (two rounds; the menu has about 7,900 red pixels against about 1,650 for the level; Up changes 46,000 to 100,000 pixels after Escape) |
| `smoke`, `focus`, `persist`, `loops` (browser) | 36, 24, 18 and 18 checks, all pass |
| `make test` (native: scripts, mmulti, all of `test-net` including the new test) | passes, exit 0, 577 `ok` lines, no `FAIL` |

**Mutation (the tests fail without the fix).**

- Browser, `WASM_DIR=build-wasm-nofix` (the same tree with `src/menues.c` from `claude`, so without the fix and with `-testmenu`): 13 passed, **10 failed**. F4 still reports 701 in the game's own account (the hook sees `current_menu`), but the sound menu is never drawn (0 red pixels), Escape never gives -1 (the game stays at 701), and the player never moves again (0 pixels changed with Up held); the Enter and Options-path checks fail for the same reason.
- Native, the same source built without the fix (`--game`): **6 checks fail** (the menu is not drawn, 1,572 red pixels against 1,655 on the level; Escape does not close it; Up changes 0 pixels), in both rounds.
- `MENUKEYS_SABOTAGE=nokey` (no F4 is pressed): 10 checks fail.

**Open.**

- D4 stays open (Findings).
- The page's short test notes in `02-emscripten-port.md` ("F4 in a game freezes the game ... don't use it") are out of date once this is merged; the coordinator can drop that line.
- The browser build was not tried in Firefox (no change that depends on the browser).
- Not verified: what the DOS original did on Escape from F4's menu (not known here; Escape returning to the game is what F2, F3, F6 and the game menu do).
