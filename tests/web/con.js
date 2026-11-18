#!/usr/bin/env node
// Browser test for "CON scripts come from the GRP only" (brief 03, decision D8): outside test mode the game reads GAME.CON,
// DEFS.CON and USER.CON from the GRP even when loose copies are in its folder, and `-x` cannot name a script that is not in the
// GRP; in test mode (?test=1 and testMode: true in config.js) a loose script is read, as loops.js needs. The page never writes a
// loose file outside test mode either.
//
//   node tests/web/con.js
//   CON_SABOTAGE=pageargs|pagefiles node tests/web/con.js   serves a damaged copy of the page's own code so that the checks must FAIL
//   WASM_DIR=<a build whose gamedef.c reads CON scripts from disk first> node tests/web/con.js   the same for the game's side (see
//       the Outcome of doco/browser/03-data-download.md)
//
// The loose scripts are the GRP's own with a comment line added, so they compile the same: only the byte counts the game prints
// ("Compiling: game.con (99639 bytes)", "Including: DEFS.CON (28893 bytes)") tell which file was read. Game data is never
// committed: they are made here, in memory, from testdata/duke3dshare.grp.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./lib.js');
const { configText } = require('./server.js');

const PORT = t.port(48301);
const SAB = process.env.CON_SABOTAGE || '';
const PATCHES = {
  // plain page passes -testloosecon too
  pageargs: ['jfduke3d.js', [["if (!TEST) { return a; }\n    if (params", "if (params"]]],
  // ?files= is honoured without test mode, and the guard in writeLooseFile is gone
  pagefiles: ['jfduke3d.js', [["var files = TEST ? (params.get('files')", "var files = true ? (params.get('files')"], ["if (!TEST) { throw new Error('a loose game file is not written outside test mode: ' + name); }", ""],
    ["if (files.length && PERSIST) { return Promise.reject(", "if (false) { return Promise.reject("]]],
};

const grp = t.readGrp(t.GRP);
const LOOSE = '\n// loose copy, added by tests/web/con.js\n';
const sizes = { game: grp['GAME.CON'].length, defs: grp['DEFS.CON'].length, user: grp['USER.CON'].length };
const looseSizes = { game: sizes.game + LOOSE.length, defs: sizes.defs + LOOSE.length, user: sizes.user + LOOSE.length };

function compiled(out) {
  const m = {};
  let x;
  if ((x = /Compiling: game\.con \((\d+) bytes\)/i.exec(out))) { m.game = +x[1]; }
  if ((x = /Including: DEFS\.CON \((\d+) bytes\)/i.exec(out))) { m.defs = +x[1]; }
  if ((x = /Including: USER\.CON \((\d+) bytes\)/i.exec(out))) { m.user = +x[1]; }
  return m;
}
const show = (m) => JSON.stringify(m);

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jfd-con-'));
  const file = (name, buf) => { const f = path.join(dir, name); fs.writeFileSync(f, buf); return f; };
  const mounts = {
    '/f/game.con': file('game.con', Buffer.concat([grp['GAME.CON'], Buffer.from(LOOSE)])),
    // (the includes are looked up by the name GAME.CON gives them, in capitals; the game's own file name is lower case)
    '/f/DEFS.CON': file('DEFS.CON', Buffer.concat([grp['DEFS.CON'], Buffer.from(LOOSE)])),
    '/f/USER.CON': file('USER.CON', Buffer.concat([grp['USER.CON'], Buffer.from(LOOSE)])),
    '/f/other.con': file('other.con', Buffer.concat([grp['GAME.CON'], Buffer.from('\n// another script, for -x\n')])),
  };
  const plainConfig = file('config-plain.js', configText(t.BUILD, { testMode: false }));
  if (SAB) {
    const p = PATCHES[SAB];
    if (!p) { throw new Error('unknown CON_SABOTAGE ' + SAB); }
    let src = fs.readFileSync(path.join(t.BUILD, p[0]), 'utf8');
    for (const [from, to] of p[1]) { if (src.indexOf(from) < 0) { throw new Error('sabotage patch does not apply: ' + from); } src = src.split(from).join(to); }
    mounts['/' + p[0]] = file('patched-' + p[0], src);
    console.log(`*** CON_SABOTAGE=${SAB}: the page's code is damaged on purpose; failing checks are expected`);
  }
  const env = await t.start(PORT, mounts);
  const plain = () => { mounts['/config.js'] = plainConfig; };
  const testMode = () => { delete mounts['/config.js']; };
  const files3 = ['/f/game.con', '/f/DEFS.CON', '/f/USER.CON'].map(encodeURIComponent).join(',');
  const outOf = (page) => page.evaluate(() => window.jfswOut.join('\n'));
  try {
    // ---- 1. A visitor's page (testMode false): loose scripts in the game's folder are ignored --------------------------------
    console.log('1. a visitor: the game reads the GRP\'s CON scripts although loose ones are in its folder');
    plain();
    {
      const { page, context, errors } = await t.open(env, '');
      await t.waitState(page, 'ready');
      // Put loose copies in the game's folder by hand (the page itself never does; this is what a stray file would be).
      await page.evaluate(([g, d, u]) => {
        const FS = window.Module.FS;
        FS.writeFile('/persist/game.con', new Uint8Array(g)); FS.writeFile('/persist/DEFS.CON', new Uint8Array(d)); FS.writeFile('/persist/USER.CON', new Uint8Array(u));
      }, ['game.con', 'DEFS.CON', 'USER.CON'].map((k) => Array.from(fs.readFileSync(mounts['/f/' + k]))));
      const listed = await page.evaluate(() => window.Module.FS.readdir('/persist').filter((n) => /\.con$/i.test(n)).sort());
      t.check(listed.join() === 'DEFS.CON,USER.CON,game.con', 'set-up: the three loose scripts are in the game\'s folder', listed.join());
      await page.click('#start');
      await page.waitForFunction(() => window.jfswOut.some((l) => /Code Size/.test(l)), null, { timeout: 30000 }).catch(() => {});
      const c = compiled(await outOf(page));
      t.check(c.game === sizes.game && c.defs === sizes.defs && c.user === sizes.user, `the game compiled the GRP's GAME.CON, DEFS.CON and USER.CON (${show(c)}; the GRP's are ${show(sizes)}, the loose ones ${show(looseSizes)})`);
      t.check(!(await page.evaluate(() => window.jfswOut.some((l) => /Using default CONs|Missing con/.test(l)))), 'the game did not fall back or complain: it read the GRP as a first choice');
      const args = await page.evaluate(() => window.jfswArgs);
      t.check(Array.isArray(args) && args.indexOf('-testloosecon') < 0, 'the page did not pass -testloosecon', JSON.stringify(args));
      t.check(errors.length === 0, 'no page error', errors.join(' | '));
      await context.close();
    }
    // The page does not write a loose file for a crafted address (?files= is a test-only parameter).
    {
      const { page, context } = await t.open(env, '?files=' + files3 + '&persist=0&args=-testloosecon&loosecon=1');
      const state = await t.waitState(page, ['ready', 'needdata', 'error']);
      const listed = await page.evaluate(() => window.Module.FS.readdir('/persist').filter((n) => n !== '.' && n !== '..').sort());
      t.check(state === 'ready' && !listed.some((n) => /\.con$/i.test(n)), '?files=...game.con&persist=0&args=-testloosecon in a visitor\'s address: ready, and no loose script was written', state + ' ' + listed.join());
      t.check((await page.evaluate(() => window.jfswTest)) === undefined, 'no test hooks on a visitor\'s page');
      await page.click('#start');
      t.check(JSON.stringify(await page.evaluate(() => window.jfswArgs)) === '[]', 'the visitor\'s game gets no arguments from the address');
      await page.waitForFunction(() => window.jfswOut.some((l) => /Code Size/.test(l)), null, { timeout: 30000 }).catch(() => {});
      const c = compiled(await outOf(page));
      t.check(c.game === sizes.game && c.defs === sizes.defs && c.user === sizes.user, 'and the game compiled the GRP\'s scripts', show(c));
      await context.close();
    }

    // ---- 2. Test mode: a loose script is read ------------------------------------------------------------------------------
    console.log('2. test mode: loose scripts are read (loops.js relies on it)');
    testMode();
    {
      const { page, context, errors } = await t.open(env, '?test=1&persist=0&files=' + files3 + '&args=' + encodeURIComponent('-v1 -l1 -s1'));
      await t.waitState(page, 'ready');
      await page.click('#start');
      await page.waitForFunction(() => window.jfswOut.some((l) => /Code Size/.test(l)), null, { timeout: 30000 }).catch(() => {});
      const c = compiled(await outOf(page));
      t.check(c.game === looseSizes.game && c.defs === looseSizes.defs && c.user === looseSizes.user, `test mode: the game compiled the loose GAME.CON, DEFS.CON and USER.CON (${show(c)}; expected ${show(looseSizes)})`);
      t.check(JSON.stringify(await page.evaluate(() => window.jfswArgs)) === JSON.stringify(['-testloosecon', '-v1', '-l1', '-s1']), 'test mode: the game was given -testloosecon, then the test\'s arguments');
      t.check(errors.length === 0, 'no page error', errors.join(' | '));
      await context.close();
    }
    // ---- 3. Test mode with ?loosecon=0: the game's own rule alone keeps the loose scripts out ---------------------------------------
    console.log('3. test mode without -testloosecon (?loosecon=0): the game ignores loose scripts by itself');
    {
      const { page, context } = await t.open(env, '?test=1&persist=0&loosecon=0&files=' + files3 + '&args=' + encodeURIComponent('-v1 -l1 -s1'));
      await t.waitState(page, 'ready');
      await page.click('#start');
      await page.waitForFunction(() => window.jfswOut.some((l) => /Code Size/.test(l)), null, { timeout: 30000 }).catch(() => {});
      const c = compiled(await outOf(page));
      t.check(c.game === sizes.game && c.defs === sizes.defs && c.user === sizes.user, `without -testloosecon the game compiled the GRP's scripts although loose ones are there (${show(c)})`);
      t.check((await page.evaluate(() => window.jfswArgs)).indexOf('-testloosecon') < 0, '?loosecon=0: the page did not pass -testloosecon');
      await context.close();
    }
    // ---- 4. -x ---------------------------------------------------------------------------------------------------------
    console.log('4. -x: a script that is not in the GRP');
    {
      const q = '?test=1&persist=0&files=' + encodeURIComponent('/f/other.con') + '&args=' + encodeURIComponent('-v1 -l1 -s1 -xother.con');
      let r = await t.open(env, q + '&loosecon=0');
      await t.waitState(r.page, 'ready');
      await r.page.click('#start');
      const state = await t.waitState(r.page, ['ended', 'error'], 30000).catch(() => 'timeout');
      const out = await outOf(r.page);
      // The game stops in gameexit() for the missing script, and on its way (showtwoscreens() before the video mode is set) it
      // divides by zero, natively too (bugs.md D16): the page says the game could not start.
      t.check(!/Compiling: other\.con/i.test(out) && !/Code Size/.test(out), '-xother.con (not in the GRP) without -testloosecon: the script is not read and the game does not go on', (out.match(/Compiling[^\n]*|Code Size[^\n]*/g) || []).join(' | '));
      t.check(state === 'error' || state === 'ended', 'the game stopped, and the page says so', state + ' ' + await r.page.evaluate(() => document.getElementById('status').textContent));
      await r.context.close();
      r = await t.open(env, q);
      await t.waitState(r.page, 'ready');
      await r.page.click('#start');
      await r.page.waitForFunction(() => window.jfswOut.some((l) => /Code Size|Missing con/.test(l)), null, { timeout: 30000 }).catch(() => {});
      const out2 = await outOf(r.page);
      t.check(/Compiling: other\.con \(\d+ bytes\)/i.test(out2) && !/Missing con/.test(out2), 'test mode: -xother.con compiles the loose script', (out2.match(/Missing[^\n]*|Compiling[^\n]*/g) || []).join(' | '));
      await r.context.close();
    }
  } finally {
    await t.stop(env);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
  return t.summary('con');
}
main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
