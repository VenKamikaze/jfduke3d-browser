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

(filled in at the end)
