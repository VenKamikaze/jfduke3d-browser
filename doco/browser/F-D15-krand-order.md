# F-D15: random numbers drawn as unsequenced call arguments (D15)

## Goal

Every compiler gives the game the same random numbers in the same order. Several calls and expressions draw two or more random numbers (`TRAND`, `krand()`, `rnd()`) as arguments of one call, or as the operands of one operator, and the C standard does not say which is evaluated first. gcc on x86-64 goes last to first, clang (so Emscripten, so the browser) first to last, so the same demo gives different debris, glass and gibs, and a game between a gcc-built native game and the browser desyncs. The fix draws each number into a local in a fixed order. The order is **gcc's**, so that today's native Linux games and demos stay bit for bit as they are (decided by the coordinator); every other compiler now agrees with them.

Found by brief 03's native-against-wasm determinism test (`bugs.md` D15): gcc native and wasm first differ at tic 210 of a demo of E1L1, in debris; a clang-built native game equals the wasm one for all 1990 tics.

## Scope

1. **The audit**, exhaustive: every full expression in `src/*.c` and `src/*.h` with two or more random calls that the standard does not sequence: arguments of one call, operands of a binary operator (not `&&`, `||`, `,`), both sides of an assignment, subscripts, initialiser lists, macros that expand to several `TRAND`s, nested macros, and calls such as `EGS(..., spawn(...))` where an argument calls something that itself draws. The CON-op handlers in `gamedef.c` included. `grep` is a start, not the audit: the list below comes from clang's AST (`tests/tools/krand-order.py`) and every match was read.
2. **The fix, on `fix/krand-arg-order` from `master`** (`55c5f95`): one commit, upstream style, line endings kept, only the order of evaluation changes.
3. **The order**: verified per site what gcc does at the optimisation levels `-O0` `-Og` `-O1` (the native build's) `-O2` `-O3`; if gcc were inconsistent, stop and report.
4. **jfbuild** (shared with jfSW) is only searched, not changed; **jfsw-browser** (`claude`, read-only) is searched for the same pattern.
5. **Integration branch `browser/F-D15-krand-order`** from `claude`: merge the fix `--no-ff`; `tests/web/determinism.js` strict (no known-failure handling); `-testarm`; this document; `bugs.md`, `code-facts.md` 19, `building.md`.

## Out of scope

- Other order-dependent code that does not draw random numbers (e.g. two calls with other side effects in one call). Not looked for; the audit's tool is about draws.
- Sending anything upstream (no pull request, no issue). Upstream `jonof/jfduke3d` `master` is still `55c5f95` (checked 18 Nov 2026, `git ls-remote`), so the bug is not fixed there.
- 32-bit builds and other CPU architectures: gcc's order is verified for x86-64 only (see Outcome).

## Acceptance criteria

1. **gcc-native unchanged**: over several demos that exercise many of the fixed sites, the gcc-native `-testdump` of the pre-fix and the fixed build is byte for byte the same; a report of which sites the demos hit, and for the others another proof that the order and the values match.
2. **wasm equals gcc-native** for every tic (strict check in `determinism.js`); clang native still equals wasm.
3. **The test fails without the fix** (strict gcc against wasm), and a clang-native build differs before and after the fix (the hoists change clang's order).
4. **No regressions**: `make test`, `make test-net`, and the `make test-web` tests that matter (`determinism`, `smoke`, `con`, `data`).

## The audit

Method, in three independent parts (all three agree):

1. **Candidates from clang's AST.** `clang -Xclang -ast-dump=json` of every `src/*.c`; the functions that call `krand()` directly or through other functions are found by a fixed point (a call of any of them counts as a draw); every call, binary operator (not `&&` `||` `,`), assignment, subscript and initialiser list that has draws in two or more of its operands is a site. 36 sites (`tests/tools/krand-order.py`; 36 on the tree before the fix, none on the fixed tree; 15 seconds, it is part of `make test`). Cross-checked against `grep -nE "TRAND|krand\(|rnd\("` of every line of `src/*.c` and `*.h` with two or more: the only lines that are not sites are continuation lines of the sites, the `TRAND` and `rnd()` definitions, and two commented-out lines (`gamedef.c:2209`, `sector.c:2177`). The `#if 0` block at `player.c:698` has no draw in a site. Every `krand()` outside a site is the only draw of its full expression.
2. **gcc's order, from its assembly.** A scratch copy with `#define TRAND krand_id(__COUNTER__)` (every textual `TRAND` gets its own number, in text order) was compiled to assembly with gcc 13.3 at `-O0`, `-Og`, `-O1 -fomit-frame-pointer`, `-O2`, `-O3` and with clang 18 at `-O0` to `-O3`, and the order of the `call krand_id` of each site read from it. **gcc is consistent**: at every site, at every level, it draws in exactly the reverse of the text order (last argument first; for the `+` of site 14, the right operand first). clang draws first to last at every site and level. At `-O3` gcc duplicates the loop of site 3 and clang one of site 15, with the same order in every copy. The instrumented binary (below) also counted, over the demos, that every site that ran drew its numbers in descending text order: 0 ascending and as many descending steps as there are adjacent pairs.
3. **Equivalence of the new code with the old, by AST, for every site whether or not a demo reaches it** (`tests/tools/krand-equiv.py OLD_TREE NEW_TREE`). For each function of `actors.c`, `sector.c`, `player.c`, `gamedef.c` and `game.c`, the sequence of full expressions that draw random numbers (old code: evaluated in gcc's order, last argument first and right operand first, every `krand()` numbered in that order; new code: each local `r0`.. folded back into the expression that uses it, numbered in the order of the statements) must be identical, draw for draw, argument for argument. **37 functions, 244 events, 0 differ.** The tool finds deliberate mistakes: two hoists in the wrong order (`lotsofmoney`), two locals swapped in a call (`guts`), a mask changed from `15` to `31` in `RANDOMSCRAP` (every function that uses it), each reported.

### Sites (all fixed)

| # | Where (`claude` `36c91d6`, before the fix) | Function | Draws | What | Verdict |
|---|---|---|---|---|---|
| 1 | `src/duke3d.h:120` `RANDOMSCRAP`, used at `actors.c:1347` `:1633` `:1915` `:2224` `:3092` `:3277` `:3292` `:3990` `:4191` `:4202` `:4220` `:5940` `:6945`, `sector.c:2046` `:2277` (15 uses) | `movefallers`, `movestandables`, `moveactors`, `moveeffectors`, `checkhitsprite` | 7 | `EGS(...)` of one piece of scrap: x, y, z, picture, angle, speed, zvel. falling steam hitting the floor (`movefallers`), a trip bomb, a seenine, a can with something in it, the Dukecar, a recon, a blown bomb or mine, the reactor, a camera, effectors 13 and 33 (the earthquake), a broken fan (`checkhitsprite`) | **fixed**: a `do { } while(0)` block that draws the seven into `rs6`..`rs0` and calls `EGS` |
| 2 | `actors.c:578` `:588` `:598` | `lotsofmoney`, `lotsofmail`, `lotsofpaper` | 2 | `EGS(.., z-(TRAND%(47<<8)), .., TRAND&2047, ..)` | **fixed** |
| 3 | `actors.c:632` | `guts` | 5 | `EGS` of a gib: x, y, z, speed, zvel (the angle `a` is drawn in a statement before, as before) | **fixed** |
| 4 | `actors.c:665` | `gutsdir` | 2 | `EGS` of a gib: speed, zvel | **fixed** |
| 5 | `actors.c:1782` | `movestandables` (`FIREEXT`) | 5 | `EGS(.., SCRAP3+(TRAND&3), .., TRAND&2047, (TRAND&63)+64, -(TRAND&4095)-.., ..)` and `z-(TRAND%(48<<8))` | **fixed** |
| 6 | `actors.c:3502` | `moveactors` (`GREENSLIME`) | 3 | glass pieces: angle, speed, zvel | **fixed** |
| 7 | `actors.c:3539`, `:3652` | `moveactors` (`GREENSLIME`, two of its death cases) | 4 | `SCRAP3` pieces: picture, angle, speed, zvel | **fixed** (both) |
| 8 | `game.c:9998` | `vglass` | 4 | `EGS(.., z-(TRAND&8191), GLASSPIECES+(z&(TRAND%3)), .., a+128-(TRAND&255), 16+(TRAND&31), ..)` | **fixed** |
| 9 | `game.c:10013`, `:10044` | `lotsofglass` (a sprite; a wall) | 2 | speed, zvel | **fixed** (both; the angle of the first is drawn in a statement before) |
| 10 | `game.c:10057` | `spriteglass` | 3 | shade, speed, zvel | **fixed** |
| 11 | `game.c:10101`, `:10124` | `lotsofcolourglass` (a sprite; a wall) | 3 and 2 | z, speed, zvel; speed, zvel | **fixed** (both) |
| 12 | `gamedef.c:2728` | `parse` (CON `debris`) | 8 | `EGS` of a piece of debris: x, y, z, two sizes, angle, speed, zvel | **fixed** |
| 13 | `player.c:139` | `tracers` (water) | 3 | `EGS(.., 4+(TRAND&3), 4+(TRAND&3), TRAND&2047, ..)` | **fixed** |
| 14 | `player.c:2584` | `processinput` | 2 | `dead_flag = (512-((TRAND&1)<<10)+(TRAND&255)-512)&2047`: two operands of a `+` | **fixed** (right operand first, as gcc) |
| 15 | `sector.c:2017` | `checkhitsprite` (`CACTUS`) | 5 | `SCRAP3` pieces | **fixed** |
| 16 | `sector.c:2032` | `checkhitsprite` (`HANGLIGHT`, `GENERICPOLE2`) | 4 | `SCRAP1` pieces | **fixed** |
| 17 | `sector.c:2063` | `checkhitsprite` (`SATELITE`, `FUELPOD`, ...) | 4 | `SCRAP1` pieces | **fixed** |

Not sites (read, nothing to fix): `ceilingglass` (one draw in its `EGS` call, the others in statements of their own), `player.c:3738` (`mulscale14(krand(), v)`, one draw), the other CON ops in `gamedef.c` (each draws once per expression), `if(rnd(X) && ...)` and the like (`&&` and `||` are sequenced), and the commented-out calls (`gamedef.c:2209`, `sector.c:2177`). No call has a function that draws (`spawn()`, `EGS()`'s callers) as one argument and a draw as another: the tool looks at every function that reaches `krand()`, and found none.

## The fix

`fix/krand-arg-order`, commit `851cc3c` (see the Outcome): `actors.c`, `game.c`, `gamedef.c`, `player.c`, `sector.c` and `duke3d.h`. Each site draws into locals `r0`, `r1`, ... (numbered in the order of the arguments they replace), assigned from the highest number down in statements of their own, and the call or expression uses the locals. `RANDOMSCRAP` is a `do { } while(0)` block with its own `rs0`..`rs6` (all 15 uses are statements). Locals are declared at the top of a function or of a block (the code is C89 in style, no mixed declarations). `krand()` and the engine are untouched.

## Decisions

1. **gcc's order, not clang's or the original compiler's.** The coordinator decided it: native Linux games and demos stay bit for bit as they are today.
2. **Hoist into locals, in statements of their own,** not a helper function: it is what upstream would write and each site stays readable. `RANDOMSCRAP` needed a block (a `do { } while(0)` macro: it stays one statement for the `for(...) RANDOMSCRAP;` and `if(...) RANDOMSCRAP;` it is used in).
3. **Locals are `int`**, as `krand()` and the expressions were: nothing is narrowed or widened (an expression's type is the same: `TRAND&2047` is an `int` either way, and the argument conversions are the same).
4. **`-testarm`** (a test hook in `src/testhooks.c`, not in the fix branch): every weapon, full ammunition and health in every tic, so the scripted player's demo shoots with the shotgun, chaingun and RPG for its whole length. The existing demos reach 2 of the 36 sites. It is an argument of every run that plays the demo (native and wasm) and does nothing without it.
5. **No change to `jfbuild` or `jfsw-browser`** (shared, read-only).
6. **`tests/tools/krand-order.py` is part of `make test`** (15 seconds; skipped with a message when clang is missing). `determinism.js` (gcc against wasm) is the dynamic check, in `make test-web`; the tool is the static one and does not need a demo to reach a place.

## Outcome

Status: **review** (branch `browser/F-D15-krand-order`; the coordinator marks it done after review and merge).

**Commits.**

- `fix/krand-arg-order` (pushed): `851cc3c`, one commit from `master` `55c5f95`: `src/actors.c`, `duke3d.h`, `game.c`, `gamedef.c`, `player.c`, `sector.c` (132 insertions, 31 deletions), the message written for upstream, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` only. Line endings kept: `player.c` and `sector.c` are CRLF in every line before and after (4558 of 4558 lines, now 4568 of 4568; 3263 of 3263, now 3281 of 3281), the other four are LF with no CR. Cherry-picked onto a detached worktree of `master`: clean, tree identical to the fix branch's (`0fa403b`). Same warnings as before (the build prints the same 12). Upstream `jonof/jfduke3d` `HEAD` is still `55c5f95` (`git ls-remote`, 18 Nov 2026).
- `browser/F-D15-krand-order` (pushed): the `--no-ff` merge of the fix, `-testarm`, the strict `determinism.js`, `krand-order.py` and `krand-equiv.py` (in `make test`), and the documents (`git log`).

**The audit: 36 sites, all fixed** (table above): 15 uses of `RANDOMSCRAP` and 21 others, in 6 files (`actors.c` 9 + 13 uses of the macro, `sector.c` 3 + 2, `game.c` 6, `gamedef.c` 1, `player.c` 2, and the macro in `duke3d.h`). No other site: `krand-order.py` finds 36 on the tree before the fix and none after; the text search of every line with two or more draws finds only the continuation lines of the same sites, the definitions and two comments. Nothing like `EGS(..., spawn(...))` exists.

**Did gcc's order vary anywhere? No.** At every one of the 36 sites gcc 13.3 (x86-64) draws in exactly the reverse of the text order, at `-O0`, `-Og`, `-O1` (the native build's), `-O2` and `-O3` alike (one pattern per site over the five levels; for the `+` of `player.c:2584` the right operand first too); clang 18 draws in text order at every site and level (`-O0` to `-O3`). Read from the assembly of a scratch copy with `#define TRAND krand_id(__COUNTER__)`. At runtime the instrumented binary agrees: over the demos every site that ran had only descending steps (over 19 demos: 0 ascending steps, 9,432 descending ones). Not checked: gcc for other targets (`-m32`, ARM, where the order can differ: `PUSH_ARGS_REVERSED`), MSVC, clang on macOS. The fix makes those builds agree with x86-64 gcc whatever their order was.

**Acceptance 1: gcc-native unchanged.** Six demos (the scripted player of `tests/tools/synth_input.c` with `-testarm`, levels E1L1 to E1L4, 2000 tics each: `b7` E1L1 seed 27, `b8` E1L2 seed 28, `a1` E1L1 seed 3, `a3` E1L3 seed 5, `a4` E1L4 seed 6, `b3` E1L3 seed 23); each played back (`-ddemo1 -testdump -testarm`, 1990 tics, 63,680 bytes of dump) with four games: gcc native before the fix (`fix` reverted on `browser/F-D15-krand-order`), gcc native after, clang native before, clang native after:

| Demo | gcc before = gcc after | clang before = clang after | clang after = gcc after | gcc before = clang before |
|---|---|---|---|---|
| `b7` | **byte-identical** (sha1 `8fd2ed27`) | differ from tic 210 (sprites, hittype) | identical | differ from tic 210 |
| `b8` | **byte-identical** (`e3bd9a3b`) | differ from tic 120 | identical | differ from tic 120 |
| `a1` | **byte-identical** (`e43ba2b2`) | differ from tic 210 | identical | differ from tic 210 |
| `a3` | **byte-identical** (`8ddcc90f`) | differ from tic 358 | identical | differ from tic 358 |
| `a4` | **byte-identical** (`5837085f`) | differ from tic 504 | identical | differ from tic 504 |
| `b3` | **byte-identical** (`a5196aa5`) | differ from tic 180 (sprites) | identical | differ from tic 180 |

(Six demos, 11,940 records, 382,080 bytes: 0 bytes differ between gcc before and after.) The determinism test's own demo (seed 1) is also played by the gcc build with the fix: it equals clang and wasm, see below; the gcc build before the fix is the `det exit 1` run of acceptance 3.

*Which sites the demos hit* (an instrumented build of the code before the fix counts every execution of a site and the order of its draws; the playbacks of these six demos): **12 of the 36**:

| Site | Runs | | Site | Runs |
|---|---|---|---|---|
| `guts` (`actors.c:632`) | 289 | | `moveeffectors` 13 (`actors.c:5940`) | 28 |
| `RANDOMSCRAP` in `moveeffectors` 33, the earthquake (`:6945`) | 61 | | `RANDOMSCRAP` in a falling steam sprite (`:1347`) | 33 |
| `RANDOMSCRAP` in `movestandables` seenine (`:1915`) | 56 | | `lotsofglass` (a wall) (`game.c:10044`) | 30 |
| `RANDOMSCRAP` in `moveactors` (`:3092`) | 64 | | `FIREEXT` (`actors.c:1782`) | 32 |
| CON `debris` (`gamedef.c:2728`) | 10 | | `RANDOMSCRAP` in `checkhitsprite` (`sector.c:2046`) | 16 |
| `RANDOMSCRAP` for a recon (`actors.c:3277`) | 5 | | `lotsofmoney` (`actors.c:578`) | 1 |

625 runs, 3,588 draws, all in the same order and with the same values before and after. The earlier pistol-only demos reached 2 (`actors.c:3092` and `:6945`); `-testarm` made it 12, and 19 demos with every weapon over E1L1 to E1L6 together reached 12 (the same ones): bullets and rockets do not often find a crate, a trip bomb or a window in 67 seconds of random walking. **The other 24 sites are not reached by any demo**: `lotsofmail`, `lotsofpaper`, `gutsdir`, `vglass`, `lotsofglass` for a sprite, `spriteglass`, `lotsofcolourglass` (both), `tracers`, `dead_flag` in `processinput`, the cactus, the hanging light, the satellite and the fan in `checkhitsprite`, and the `RANDOMSCRAP`s of the trip bomb, the can, the second recon, the heavy bomb, the reactor and the camera, and the three `GREENSLIME` ones. For those, **two other proofs**, both for all 36 sites: gcc's assembly (above: every site, five optimisation levels), and the AST equivalence of the old code in gcc's order with the new code (`krand-equiv.py`: 37 functions, 244 events, 0 differ; and three deliberate mistakes in a scratch copy, an order swap, a wrong local and a wrong mask, each reported). The AST check is what makes a transcription error (a wrong local or a wrong mask) in a site no demo reaches visible.

**Acceptance 2: wasm equals gcc native.** `node tests/web/determinism.js` (strict: `KNOWN.D15`, `xfail` and `DET_STRICT` are gone): **22 passed, 0 failed**: seed 1, 2000 tics recorded with `-testarm` by the scripted player; gcc native twice, clang native and wasm each play 1990 tics with the same 1990 records; "gcc native against wasm": first difference none; clang native against wasm: none; the nudge mutation is caught at tic 600 (players); the browser-recorded demo (890 records): gcc native, clang native and wasm identical. Run before and after merging `claude` (F-D3, `6a0b1f5`): 22 passed, 0 failed both times (seed 1 only; other seeds not run). The container restarted once during the work; the native and wasm builds were redone from clean (`build-wasm.sh veryclean`) and every step below was re-run after the merge.

**Acceptance 3: the test fails without the fix.** On `browser/F-D15-krand-order` with the fix reverted (`git apply -R` of `851cc3c`; native and wasm rebuilt), the same `determinism.js`: **20 passed, 2 failed**: "GCC NATIVE AGAINST WASM ... first difference: tic 210 (sprites, hittype)" and the same for the browser-recorded demo (tic 210); "WASM AGAINST CLANG-NATIVE" still passes (and so do the two mutation checks): the difference is the compiler's order, as D15 said. And the clang-native build before the fix differs from the clang-native build after it on all six demos (table above: tic 120 to 504): the hoists change clang's order, and the one after equals gcc.

**Acceptance 4: no regressions.** `make test` (native, from the branch, under `flock`, with `env --default-signal=INT` because of decision 5): **exit 0** on the merged branch (also on the branch before the merge), about 16 minutes: `tests/fetch-test-data.sh` 40 passed, `tests/run-headless.sh` 24 passed, `krand-order.py` 0 sites, `test-mmulti` (10 runs), and `test-net`'s 12 invocations (relay with 2, 3 and 4 players, with impairment, plain UDP, `--nosound`, `test-desync`, `test-player-announce`, `test-level-exit`, `test-predict-pure`, `test-single`: demo playback, `test-udp-unchanged`, `test-errors`, `test-relay-lost`, `test-shareware-gate`) and F-D3's `test-menu-f4.sh` all PASS: 577 `ok` lines, 17 PASS, 0 failures (565 `ok` before the merge). `make test-web`, the tests that matter: `determinism.js` (22 passed, above), `smoke.js` **36 passed, 0 failed** (before and after the merge), `con.js` **17 passed, 0 failed**, `data.js` **193 passed, 0 failed**. (`persist`, `focus`, `loops` and `frametime` not run: nothing of this change touches them.)

**Tools made, in `tests/tools/`:** `krand-order.py` (static check, in `make test`), `krand-equiv.py` (the equivalence proof); in `src/testhooks.c`: `-testarm`. The recording and counting scripts used for the numbers above were scratch (a counting build with `TRAND` redefined, an `LD_PRELOAD` shim, a loop over demos) and are not committed: the demos are not committed either (a recording depends on the clock; `determinism.js` records its own).

**jfbuild (shared with jfSW): no site, not changed.** `krand()` is `jfbuild/src/engine.c:9693`; nothing in `jfbuild/src` or `include` calls it (the editor `build.c` does not either). The C library's `rand()` is used in `mdsprite.c:1538-1542` (four statements, one `rand()` each, for the voxel texture drawing) and `mmulti.c:532` (the simulated packet loss, `SIMMIS`): none in one expression with another, none in the simulation.

**jfsw-browser (`claude`, read-only): very likely the same problem.** `src/game.h:113-121`: `RANDOM_P2`, `RANDOM_RANGE` and `RANDOM()` call `krand1()`. Sites where two draws are the operands of one `-` (unspecified order, and the result is negated if the order is swapped): `src/weapon.c:10190-10192` (`np->xvel += (RANDOM_RANGE(140)-RANDOM_RANGE(140));` and the same for `yvel`, `zvel`) and `src/weapon.c:11643-11645` (`dx += RANDOM_RANGE(1000)-RANDOM_RANGE(1000);`, `dy`, and `dz = SPRITEp_MID(sp) + RANDOM_RANGE(1000)-RANDOM_RANGE(1000);`). Six statements found by a text scan of every statement with two or more draws in `src/*.c` (a rough scan, no AST: calls whose arguments are on several lines are included, none found); the other statements with two draws (`morph.c:349`, `:429`, `player.c:5434`, `ripper2.c:1040`, `skel.c:555`, `:560`, `weapon.c:16651`) are sequenced by an `if` or `&&`. So jfSW has 6 places, not 36, but the same native-against-wasm difference when a native gcc game meets the browser's clang one; jfSW's own determinism test (native against wasm) would show it whenever the scripted player reaches `weapon.c:10190` (`DoRail`, the puffs of a rail gun shot) or `:11643` (`SpawnGrenadeExp`). The cure is the same: draw into locals in gcc's order (right operand first). Not changed here.

**Decisions** (the ones not already in the list above).

1. `RANDOMSCRAP` as a `do { } while(0)` block with its own locals, not a function: every use is `for(...) RANDOMSCRAP;` or `if(...) RANDOMSCRAP;` (a statement), so the block fits, and upstream needs no new function and no prototype.
2. Locals `r0`..`rN` named in text order, drawn from the highest down: the diff shows which draw replaced which argument, and a reader sees the order.
3. `-testarm` is a test hook (browser branch), not part of the fix: it makes the scripted player's demo reach 12 of the 36 sites instead of 2. It does not change a game without the argument. In the determinism test it is on by default (`DET_ARM=0` turns it off) and it gives the recorded demo's whole length to monsters and weapons; the browser-recorded demo is played with it too (recorded without).
4. `krand-order.py` in `make test`, skipped with a message without clang (exit 3, like `determinism.js`'s NOT RUN).
5. `tests/run-headless.sh` has one check ("SIGINT to the script: its status") that fails when `make test` runs in a shell whose background jobs ignore SIGINT (a job started with `nohup ... &`); with `env --default-signal=INT` it passes. Not a change of this brief.

**Open.** The 24 sites no demo reaches have no dynamic check; their checks are the assembly and the AST (above). A test hook that breaks a window, a crate or a cactus at a chosen tic would give each a dynamic one: not made (the AST check covers what such a test would: the same draws reaching the same arguments). The gcc order for non-x86-64 targets is untested.

### Fix round (after the independent review)

The review found no blocker (the same 36 sites with its own scanner; old and new code give identical arguments for every hunk at gcc `-O0` to `-O3`). Test issues fixed on `browser/F-D15-krand-order` only (`fix/krand-arg-order` is untouched, `851cc3c`):

1. **`krand-order.py` could pass having scanned nothing.** A file clang could not compile was "skipped", so `krand-order.py src/nonexistent.c` exited 0 with "0 site(s) in 0 file(s)". Now any file asked for that does not exist or does not compile is exit 1 ("FAILED: could not scan ..."); exit 3 (NOT RUN) only when clang is missing. The default list leaves out the Windows-only `src/startwin_game.c` by name (19 files). Checked: a missing file 1, `startwin_game.c` 1, no arguments 0 (19 files, 0 sites), no clang on `PATH` 3.
2. **Makefile:** the `krand-order.py` line follows the `test-menu-f4.sh` convention: exit 3 prints `*** krand-order.py: NOT RUN (not counted as passed; see its message above)`, any other non-zero fails.
3. **`determinism.js`: "monsters took part" measured the player's health**, which `-testarm` refills in every tic (`hurt` stays 0; seed 7 failed it with all equality checks passing). Now it counts the actors (`statnum` 1: monsters, barrels and the like) that, by a later `-teststate` snapshot, have less health (`extra`), another picture (a pain or death frame) or are gone, compared with tic 1. Seed 1: 5 of 11 actors hit or changed, 4 gone; seed 7: 5 of 11, 0 gone (it walked 76,304 units and shot things without killing any). Both pass: `determinism.js` 22 passed, 0 failed for `DET_SEED=1` and `DET_SEED=7` (gcc native, clang native and wasm identical for all 1990 tics, both).
   *Sites reached per seed* (a scratch build with `TRAND` counting its calls per source line, not committed; the demo of the run played back with `-testarm`): seed 1 reaches **2 of the 36** (`RANDOMSCRAP` in `moveactors` `actors.c` 32 times and in the earthquake effector 10 times), seed 7 reaches **3** (the same two, 32 and 13 times, and `RANDOMSCRAP` in `checkhitsprite` 16 times). The determinism test's own demo is thin on sites; the six demos of the Outcome above (12 of 36) and the static checks are what cover the rest.
4. **`-testarm` is in `TestVersionSalt()`** (bit value 64, as `-testfire` has 32), so players started with and without it refuse each other instead of desyncing; documented in `testhooks.h` and `testhooks.c`. The largest version byte is 134 + 120 = 254.
5. The over-indented `t.check(dAW === null, ...)` line is fixed; the comment in `testhooks.c` reflowed.
6. `bugs.md` D15: the Where column says 21 other calls and expressions (36 sites in all), and "needs its own brief" is gone.
