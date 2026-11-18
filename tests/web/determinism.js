#!/usr/bin/env node
// Native against WebAssembly determinism test (brief 03; deferred from brief 02). The same game, run natively and in the browser
// from the same input, must give the same state tic for tic: `-testdump` (src/testhooks.c, brief 01) writes one record of 32 bytes
// per game tic, hashes of the players, sprites, hittype, sectors, walls and the rest of the simulation's state and the random seed.
//
//   node tests/web/determinism.js         needs ./duke3d (make), build-wasm/, testdata/duke3dshare.grp, cc with the SDL2 headers, and
//                                          clang and rsync (tests/tools/build-native-clang.sh); without them it prints NOT RUN and exits 3
//   DET_SEED=2 node tests/web/determinism.js     another scripted player (the default is 1)
//   DET_TICS=2000 DET_WARP=1 DET_ARM=1 DET_REVERSE=1 DET_KEEP=0 ...      (the defaults; see the code)
//
// The shareware GRP has no demo, so the input is made at test time. A demo records only the players' inputs, so a native recording
// of a scripted player is all the wasm game needs:
//   1. native: tests/tools/synth_input.c (an LD_PRELOAD shim for SDL_PollEvent, jfSW's tool with Duke's keys) plays a pseudo-random
//      "player" (walking, turning, firing, opening, changing weapon, running) into the native game with no display; the game records
//      it with -r (demo1.dmo) and quits by itself after DET_TICS game tics (-testquit);
//   2. the demo is played back (-d) with -testdump: natively twice, with a clang-built native game, and in the browser;
//   3. the dumps are compared record by record.
// Why a demo and not a test-only input hook in the game: nothing in the game changes, so it is the game that is tested, and the demo is
// the input a player would have made; why a recording made at test time and not a committed demo: the demo holds nothing but inputs, so
// there is no file to go stale when the simulation changes (jfSW commits one), and every run (and every DET_SEED) is another input.
// A recording's own dump is not compared: a recording game and its playback differ from tic 1 (bugs.md D2, camera sprites).
//
// The scripted player is checked to have done something that makes the comparison worth having: it moved, fired, was hurt or killed
// something, and sectors moved (doors, lifts). Snapshots of the state as text (-teststate) at three tics give those numbers.
//
// What is compared, and why there are two natives:
//   gcc-native A against gcc-native B   the native game is deterministic (the same demo gives the same dump);
//   gcc-native A against wasm W          what a player on a Linux desktop build meets in a game with a browser, and the check
//                                        that bugs.md D15 is fixed: the C standard leaves the order in which a call's arguments are
//                                        evaluated open, gcc goes right to left and clang (Emscripten's compiler) left to right, and the
//                                        game had calls with several random numbers as arguments (RANDOMSCRAP, EGS(...) of debris, glass
//                                        and guts). The fix (F-D15) draws them into locals in gcc's order, so every compiler agrees: this
//                                        is a plain must-equal check;
//   clang-native C against wasm W        the browser's game equals a desktop game built with the same compiler, tic for tic. It tells a
//                                        difference of compilers from any other difference between the native game and the browser's
//                                        (the first one printed when A and W differ, and what D15 looked like before it was fixed);
//   W with -testnudge                    the comparison fails when the wasm game differs: one player nudged at one tic is found at that tic.
//   a demo recorded in the browser       the other direction: the page types a player's keys, the wasm game records a demo, and native
//                                        (gcc and clang) and wasm play it back with the same dumps (DET_REVERSE=0 skips this part).
// The scripted player and the playbacks use -testarm (src/testhooks.c: every weapon, full ammunition and health in every tic), so that
// the recorded demo goes on for the whole time and shoots with every weapon: shotgun, chaingun, RPG. That is what reaches most of the
// places F-D15 changed (debris of broken things, glass, guts of killed monsters). DET_ARM=0 plays with the starting pistol only.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const t = require('./lib.js');

const PORT = t.port(48102);
const SEED = +(process.env.DET_SEED || 1);
const TICS = +(process.env.DET_TICS || 2000);           // game tics of the recorded demo (30 a second)
const WARP = +(process.env.DET_WARP || 1);              // the browser's clock runs this many times faster (CI shortcut)
const ARM = process.env.DET_ARM !== '0';               // -testarm: every weapon, full ammunition and health
const REVERSE = process.env.DET_REVERSE !== '0';
const KEEP = process.env.DET_KEEP === '1';              // keep the work directory (and print it)
const DUKE = path.join(t.root, 'duke3d');
const TOOLS = path.join(t.root, 'tests', 'tools');
const HEADLESS = path.join(t.root, 'scripts', 'run-headless.sh');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jfd-det-'));   // removed at the end
process.on('exit', () => { if (KEEP) { console.log('work directory kept: ' + tmp); } else { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* best effort */ } } });

// ---- helpers --------------------------------------------------------------------------------------------------------

const NAMES = ['tic', 'seed', 'players', 'sprites', 'hittype', 'sectors', 'walls', 'other'];
function records(buf) {
  const out = [];
  for (let i = 0; i + 32 <= buf.length; i += 32) { const r = []; for (let k = 0; k < 8; k++) { r.push(buf.readUInt32LE(i + 4 * k)); } out.push(r); }
  return out;
}
// The first record at which two dumps differ: { tic, record, parts } or null when they are the same; length mismatches count.
function firstDiff(a, b) {
  const ra = records(a), rb = records(b), n = Math.min(ra.length, rb.length);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 8; k++) {
      if (ra[i][k] !== rb[i][k]) { return { record: i + 1, tic: ra[i][0], parts: NAMES.slice(1).filter((_, j) => ra[i][j + 1] !== rb[i][j + 1]) }; }
    }
  }
  return ra.length === rb.length ? null : { record: n + 1, tic: n + 1, parts: ['length: ' + ra.length + ' against ' + rb.length + ' records'] };
}
const describe = (d) => (d ? `tic ${d.tic} (${d.parts.join(', ')})` : 'none');

// Runs a command; resolves { status, out }.
function run(cmd, args, opts) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, Object.assign({ stdio: ['ignore', 'pipe', 'pipe'] }, opts || {}));
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (status) => resolve({ status, out }));
    p.on('error', (e) => resolve({ status: -1, out: String(e) }));
  });
}

// Native: plays `demo` (a Buffer with .tics) with -testdump, in a directory of its own; resolves { dump, state, out, status }.
function nativePlay(label, game, demo, extra) {
  const dir = fs.mkdtempSync(path.join(tmp, label + '-'));
  fs.writeFileSync(path.join(dir, 'demo1.dmo'), demo);
  const quit = Math.max(1, demo.tics - 10);
  const args = ['--workdir', dir, '--timeout', String(Math.ceil(quit / 30) + 150), '--game', game, '--', '-ddemo1', '-testdump' + 'play.dump', '-testquit' + quit].concat(ARM ? ['-testarm'] : [], extra || []);
  return run(HEADLESS, args).then((r) => {
    const f = (n) => (fs.existsSync(path.join(dir, n)) ? fs.readFileSync(path.join(dir, n)) : null);
    return { dump: f('play.dump'), state: f('play.dump.state'), out: r.out, status: r.status, quit };
  });
}

// What the state text of -teststate says: per snapshot, the first player's fields and the number of sprites of each kind.
function parseState(buf) {
  const snaps = {};
  let cur = null;
  for (const line of buf.toString('latin1').split('\n')) {
    const m = /^t(\d+) randomseed=/.exec(line);
    if (m) { cur = snaps[+m[1]] = { player: null, actors: 0, sprites: 0 }; continue; }
    if (!cur) { continue; }
    if (line.startsWith('player 0 ')) { cur.player = Object.fromEntries(line.split(' ').slice(2).map((x) => { const i = x.indexOf('='); return [x.slice(0, i), +x.slice(i + 1)]; })); }
    else if (line.startsWith('sprite ')) { cur.sprites++; if (/ statnum=1 /.test(line + ' ')) { cur.actors++; } }
  }
  return snaps;
}

function activity(playback, dump) {
  const snaps = parseState(playback.state);
  const tics = Object.keys(snaps).map(Number).sort((a, b) => a - b);
  const first = snaps[tics[0]];
  const ammo = (p) => p.ammo_amount1 + p.ammo_amount2 + p.ammo_amount3 + p.ammo_amount4;
  let moved = 0, minAmmo = 1e9, hurt = 0, minActors = 1e9;
  for (const k of tics) {
    const p = snaps[k].player;
    moved = Math.max(moved, Math.abs(p.posx - first.player.posx) + Math.abs(p.posy - first.player.posy));
    minAmmo = Math.min(minAmmo, ammo(p));
    hurt = Math.max(hurt, first.player.last_extra - p.last_extra);
    minActors = Math.min(minActors, snaps[k].actors);
  }
  const rs = records(dump);
  return {
    snapshots: tics, moved, ammoSpent: Math.max(0, ammo(first.player) - minAmmo), hurt,
    killed: Math.max(0, first.actors - minActors), actorsAtStart: first.actors,
    sectorStates: new Set(rs.map((r) => r[5])).size, tics: rs.length,
  };
}

async function main() {
  if (!fs.existsSync(DUKE)) { throw new Error('./duke3d not found: run make (the native build) first'); }

  // --- 0. the tools ------------------------------------------------------------------------------------------------
  // The strict comparison is against a clang-built native game (header): without clang and rsync there is nothing valid to run.
  const missing = ['clang', 'clang++', 'rsync'].filter((c) => spawnSync('sh', ['-c', `command -v ${c}`]).status !== 0);
  if (missing.length) { console.log(`determinism: NOT RUN: ${missing.join(' and ')} not found (the native game is built with clang for the main comparison)`); process.exit(3); }
  const shim = path.join(tmp, 'synth_input.so');
  const cc = spawnSync('sh', ['-c', `cc -shared -fPIC -O2 -o '${shim}' '${path.join(TOOLS, 'synth_input.c')}' $(sdl2-config --cflags) -ldl`], { encoding: 'utf8' });
  if (cc.status !== 0) { throw new Error('could not build tests/tools/synth_input.c (needs cc and the SDL2 headers): ' + cc.stderr); }
  const b = spawnSync(path.join(TOOLS, 'build-native-clang.sh'), [], { encoding: 'utf8' });
  if (b.status !== 0) { throw new Error('tests/tools/build-native-clang.sh failed: ' + (b.stderr || b.stdout).trim().split('\n').slice(-3).join(' ')); }
  const clang = b.stdout.trim().split('\n').pop();
  console.log(`scripted player: seed ${SEED}, ${TICS} game tics (${(TICS / 30).toFixed(0)} s); gcc native ${DUKE}; clang native ${clang}`);

  // --- 1. a native recording of a scripted player --------------------------------------------------------------------
  const recdir = fs.mkdtempSync(path.join(tmp, 'rec-'));
  const rec = await run(HEADLESS,
    ['--workdir', recdir, '--timeout', String(Math.ceil(TICS / 30) + 120), '--game', DUKE, '--', '-v1', '-l1', '-s2', '-r', '-testdump' + 'rec.dump', '-testquit' + TICS].concat(ARM ? ['-testarm'] : []),
    { env: Object.assign({}, process.env, { LD_PRELOAD: shim, SYNTH_SECONDS: String(Math.ceil(TICS / 30) + 60), SYNTH_SEED: String(SEED), SYNTH_FIRE: '25', SYNTH_FORWARD: '85' }) });
  t.check(rec.status === 0, 'native: the scripted player recorded a demo and the game quit by itself (exit 0)', `status ${rec.status}: ${rec.out.slice(-300)}`);
  const demoFile = path.join(recdir, 'demo1.dmo');
  const demo = fs.existsSync(demoFile) ? fs.readFileSync(demoFile) : Buffer.alloc(0);
  const recDump = fs.existsSync(path.join(recdir, 'rec.dump')) ? fs.readFileSync(path.join(recdir, 'rec.dump')) : Buffer.alloc(0);
  demo.tics = recDump.length / 32;
  t.check(demo.length > 1000 && demo.tics >= TICS - 2, `native: the demo is ${demo.length} bytes of ${demo.tics} game tics`);
  if (demo.length < 1000) { return t.summary('determinism'); }
  const demoPath = path.join(tmp, 'demo1.dmo');
  fs.writeFileSync(demoPath, demo);

  // --- 2. playbacks: gcc native twice, clang native, and the browser ----------------------------------------------------
  const quit = Math.max(1, demo.tics - 10);
  const mounts = { '/f/demo1.dmo': demoPath };
  const env = await t.start(PORT, mounts);
  try {
    const stateArgs = [0.3, 0.6, 0.9].map((f) => '-teststate' + Math.floor(quit * f));
    console.log(`playing the demo (${quit} tics) natively twice, with clang, and in the browser...`);
    const [A, B] = await Promise.all([nativePlay('gcc-a', DUKE, demo, stateArgs), nativePlay('gcc-b', DUKE, demo)]);
    const pC = nativePlay('clang', clang, demo);
    const pW = t.runGame(env, { args: ['-ddemo1', '-testdump' + 'play.dump', '-testquit' + quit].concat(ARM ? ['-testarm'] : []), files: [{ name: 'demo1.dmo' }], read: ['play.dump'], warp: WARP, timeoutMs: 600000 });
    const [C, W] = await Promise.all([pC, pW]);
    for (const [name, r] of [['native A', A], ['native B', B], ['clang native', C]]) {
      if (r) { t.check(r.status === 0 && r.dump && r.dump.length / 32 === quit, `${name}: played the demo and quit at tic ${quit} (${r.dump ? r.dump.length / 32 : 0} records, exit ${r.status})`); }
    }
    const wd = W.files['play.dump'];
    t.check(W.state === 'ended' && W.exit && W.exit.code === 0 && wd && wd.length / 32 === quit, `wasm: played the demo and quit at tic ${quit} (${wd ? wd.length / 32 : 0} records; ${W.state} ${JSON.stringify(W.exit)})`);
    t.check(W.errors.length === 0, 'wasm: no page error', W.errors.join(' | '));
    // Frame intervals of the wasm playback, for information only: three native games run at the same time here, so they say little
    // (jfSW checks them in this test; here tests/web/frametime.js measures them on an otherwise quiet machine).
    {
      const f = W.frames.map((x) => x - W.t0).filter((x) => x > W.frames[0] - W.t0 + 10000);
      const iv = []; for (let i = 1; i < f.length; i++) { iv.push(f[i] - f[i - 1]); }
      iv.sort((x, y) => x - y);
      if (iv.length > 100) { console.log(`  info: wasm frame intervals during the playback (ms): median ${iv[Math.floor(iv.length / 2)].toFixed(1)}, p95 ${t.pct(iv, 0.95).toFixed(1)}, p99 ${t.pct(iv, 0.99).toFixed(1)}, max ${iv[iv.length - 1].toFixed(0)} over ${iv.length} frames; load average ${os.loadavg().map((x) => x.toFixed(1)).join(' ')}`); }
    }
    if (!A.dump || !wd) { return t.summary('determinism'); }

    // --- 3. the scripted player did something -------------------------------------------------------------------------
    const act = activity(A, A.dump);
    console.log(`  activity over ${act.tics} tics (state at tics ${act.snapshots.join(', ')}): moved ${act.moved} units, spent ${act.ammoSpent} rounds, health lost ${act.hurt}, ${act.killed} of ${act.actorsAtStart} monsters gone, ${act.sectorStates} different sector states`);
    t.check(act.tics >= 1500, `the dumps cover ${act.tics} game tics`);
    t.check(act.moved >= 1000, 'the scripted player walked around', String(act.moved));
    t.check(act.ammoSpent >= 3, 'the scripted player fired', String(act.ammoSpent));
    t.check(act.hurt >= 1 || act.killed >= 1, 'monsters took part: the player was hurt or something was killed', `hurt ${act.hurt}, killed ${act.killed}`);
    t.check(act.sectorStates >= 10, 'sectors moved (doors, lifts, lights)', String(act.sectorStates));

    // --- 4. the comparisons --------------------------------------------------------------------------------------------
    const dAB = firstDiff(A.dump, B.dump);
    t.check(dAB === null, `native: two playbacks of the demo give the same ${quit} records (first difference: ${describe(dAB)})`);
    const dAW = firstDiff(A.dump, wd);
    const dCW = C.dump ? firstDiff(C.dump, wd) : { tic: -1, parts: ['no dump'] };
    t.check(dCW === null, `WASM AGAINST CLANG-NATIVE: the same ${quit} game tics, record for record (first difference: ${describe(dCW)})`);
    const dAC = C.dump ? firstDiff(A.dump, C.dump) : null;
    console.log(`  first difference, gcc native against clang native: ${describe(dAC)}; gcc native against wasm: ${describe(dAW)}`);
      t.check(dAW === null, `GCC NATIVE AGAINST WASM: the same ${quit} game tics, record for record (D15: the order in which the compilers evaluate a call's arguments; first difference: ${describe(dAW)})`);

    // --- 5. the comparison fails when the wasm build differs ------------------------------------------------------------
    // A wasm game that differs by one player nudged 8 units at one tic (-testnudge, the hook brief 01 made for this), compared with
    // the unperturbed wasm run: the first difference must be at that tic and in the players' state, and the tics before it agree.
    {
      const T = Math.min(600, Math.floor(quit / 3));
      const r5 = await t.runGame(env, { args: ['-ddemo1', '-testdump' + 'play.dump', '-testquit' + (T + 40), '-testnudge' + T].concat(ARM ? ['-testarm'] : []), files: [{ name: 'demo1.dmo' }], read: ['play.dump'], warp: WARP, timeoutMs: 400000 });
      const nd = r5.files['play.dump'];
      const ref = wd;      // the unperturbed wasm run (which is equal to the clang native one, checked above)
      const d = nd ? firstDiff(ref.subarray(0, nd.length), nd) : { tic: -1, parts: ['no dump'] };
      t.check(!!d && d.tic === T && d.parts.indexOf('players') >= 0, `mutation: a wasm game with one player nudged at tic ${T} is caught at that tic, in the players' state (first difference: ${describe(d)})`);
      t.check(!!nd && Buffer.compare(ref.subarray(0, (T - 1) * 32), nd.subarray(0, (T - 1) * 32)) === 0, `mutation: and the ${T - 1} tics before it still agree`);
    }

    // --- 6. the other direction: a demo recorded in the browser ----------------------------------------------------------
    if (REVERSE) {
      console.log('a demo recorded in the browser, played natively and in the browser...');
      const keys = async (page) => {
        // 24 s of play typed by the test: pistol, then turn and fire, now and then step forward and open.
        await page.waitForTimeout(3500);
        await t.tap(page, '2');
        const t0 = Date.now();
        let i = 0;
        while (Date.now() - t0 < 24000) {
          const fwd = i % 3 !== 2;
          const turn = i % 2 ? 'ArrowLeft' : 'ArrowRight';
          await page.keyboard.down(turn);
          if (i % 3 === 1) { await page.keyboard.down('Control'); }
          if (fwd) { await page.keyboard.down('ArrowUp'); }
          await page.waitForTimeout(800);
          if (fwd) { await page.keyboard.up('ArrowUp'); }
          if (i % 3 === 1) { await page.keyboard.up('Control'); }
          await page.keyboard.up(turn);
          if (i % 4 === 3) { await t.tap(page, 'Space', 100); }
          await page.waitForTimeout(100);
          i++;
        }
      };
      const rtics = 900;
      const r6 = await t.runGame(env, { args: ['-v1', '-l1', '-s2', '-r', '-testquit' + rtics], script: keys, warp: 1, read: ['demo1.dmo'], timeoutMs: 120000 });
      const wdemo = r6.files['demo1.dmo'];
      t.check(!!wdemo && wdemo.length > 500, `wasm: recorded a demo of its own (${wdemo ? wdemo.length : 0} bytes; ${r6.state} ${JSON.stringify(r6.exit)})`);
      if (wdemo && wdemo.length > 500) {
        wdemo.tics = rtics;
        const wp = path.join(tmp, 'wasm1.dmo');
        fs.writeFileSync(wp, wdemo);
        mounts['/f/wasm1.dmo'] = wp;
        const q2 = rtics - 10;
        const [nA, nC] = await Promise.all([nativePlay('rev-gcc', DUKE, wdemo), nativePlay('rev-clang', clang, wdemo)]);
        const r7 = await t.runGame(env, { args: ['-dwasm1', '-testdump' + 'play.dump', '-testquit' + q2].concat(ARM ? ['-testarm'] : []), files: [{ name: 'wasm1.dmo' }], read: ['play.dump'], warp: WARP, timeoutMs: 300000 });
        const w7 = r7.files['play.dump'];
        t.check(r7.state === 'ended' && !!w7 && w7.length / 32 === q2, `wasm: played its own demo (${w7 ? w7.length / 32 : 0} records)`);
        t.check(!!nA.dump && nA.dump.length / 32 === q2, `native: played the browser's demo (${nA.dump ? nA.dump.length / 32 : 0} records)`);
        const dr = nC.dump && w7 ? firstDiff(nC.dump, w7) : { tic: -1, parts: ['missing'] };
        t.check(dr === null, `browser-recorded demo: clang native and wasm give the same ${q2} records (first difference: ${describe(dr)})`);
        if (nA.dump && w7) {
          const dra = firstDiff(nA.dump, w7);
          const drc = nC.dump ? firstDiff(nA.dump, nC.dump) : null;
          console.log(`  browser-recorded demo, first difference, gcc native against clang native: ${describe(drc)}; gcc native against wasm: ${describe(dra)}`);
          t.check(dra === null, `browser-recorded demo: gcc native and wasm give the same ${q2} records (first difference: ${describe(dra)})`);
        }
      }
    }
  } finally {
    await t.stop(env);
  }
  return t.summary('determinism');
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
