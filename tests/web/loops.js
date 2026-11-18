#!/usr/bin/env node
// The game's blocking loops (code-facts.md section 4) in the browser (brief 02, scope item 3). New in the Duke port.
//
//   node tests/web/loops.js
//   LOOPS_SABOTAGE=nokey node tests/web/loops.js   # presses no key: the loops that wait for one never end, those checks must FAIL
//   LOOPS_SABOTAGE=hang  node tests/web/loops.js   # the page's main thread is held for 1.5 s inside a measurement, as a loop that
//                                                  # never yields would hold it: the responsiveness checks must FAIL
//
// Duke's loops wait without returning to the main loop: they poll the clock and the keyboard (`handleevents()`) and draw
// (`nextpage()`). In the browser the engine hands control back to the page from those two calls (jfbuild/src/sdlayer2.c,
// ASYNCIFY), so a loop that reaches either one keeps the page alive. This test goes through the loops that the shareware data
// can reach and asks of each stage of a loop two things: the page stays responsive while it waits (requestAnimationFrame
// callbacks keep coming, with no gap over 1 s), and the game yields (Module.jfswYieldLog grows: more than 15 yields a second);
// and of the loop itself that it ends, by the clock or by a key.
//
//   1. Logo(): the 3D Realms screen (7 s) and the title screen (8 s), `fadepal()`/`palto()` between them.
//   2. Choosing New Game: `newgame()` waits for the skill's voice (`issoundplaying()`), `enterlevel()` loads with `precache()`
//      and the other loops that call `handleevents()` every few items, `waitforeverybody()`.
//   3. The end of episode 1, which `dobonus()` plays: the animation loop (`while (1)`, any key), then `userack()` screens,
//      the "completed" screen (`while (1)`, any key) and the order pages (`userack()`), back to the main menu. The shareware
//      level has no exit that a script can reach, so the end is made by a loose GAME.CON (test only: `?files=`) that has the
//      player run `endofgame` three seconds into the level; everything after that is the game's own code. The shareware
//      GRP has no .anm movies (playanm() returns at once), no demos and no registered episodes, so those loops are not reached
//      (the Outcome of brief 02 lists them).
// Port 49105.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const t = require('./lib.js');

const PORT = t.port(49105);
const SAB = process.env.LOOPS_SABOTAGE || '';
const NOKEY = SAB === 'nokey';
const HANG = SAB === 'hang';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function key(page, k, ms) { if (!NOKEY) { await t.tap(page, k, ms || 120); } else { await sleep(ms || 120); } }

// How the page and the game fare over `ms`: the largest gap between animation frames, how many frames, how many yields the
// game made. A page held by the game never answers, so the question has a time limit.
let hung = false;
async function window_(page, ms) {
  if (HANG && !hung) { hung = true; page.evaluate((n) => { const t0 = performance.now(); while (performance.now() - t0 < n) { /* hold the main thread */ } }, 1500).catch(() => {}); }
  const probe = page.evaluate((span) => new Promise((resolve) => {
    const y0 = Module.jfswYieldLog.length, t0 = performance.now();
    let last = t0, max = 0, n = 0;
    const f = () => {
      const now = performance.now();
      max = Math.max(max, now - last); last = now; n++;
      if (now - t0 < span) { requestAnimationFrame(f); } else { resolve({ gap: max, frames: n, yields: (Module.jfswYieldLog.length - y0) * 1000 / (now - t0) }); }
    };
    requestAnimationFrame(f);
  }), ms);
  return Promise.race([probe, sleep(ms + 8000).then(() => ({ gap: Infinity, frames: 0, yields: 0 }))]);
}
const okWindow = (w) => w.gap < 1000 && w.yields > 15;
const describe = (w) => `largest gap ${w.gap === Infinity ? 'unbounded' : Math.round(w.gap) + ' ms'}, ${w.frames} frames, ${Math.round(w.yields)} yields a second`;

// The main menu: the nuke symbols left and right of the items, on the same row (as smoke.js; 6 rows 58 px apart).
const COLUMNS = [{ x: 120, y: 203, width: 100, height: 348 }, { x: 790, y: 203, width: 100, height: 348 }];
async function menuUp(page, decoder) {
  for (let k = 0; k < 6; k++) {
    const rows = [];
    for (const col of COLUMNS) {
      const png = await page.screenshot({ clip: col, type: 'png' });
      const counts = await decoder.evaluate(async (data) => {
        const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
        const px = g.getImageData(0, 0, c.width, c.height).data;
        const n = [0, 0, 0, 0, 0, 0];
        for (let i = 0; i < px.length; i += 4) { if (px[i] + px[i + 1] + px[i + 2] > 330) { n[Math.min(5, Math.floor(Math.floor(i / 4 / c.width) / 58))]++; } }
        return n;
      }, png.toString('base64'));
      const best = counts.indexOf(Math.max(...counts));
      const others = counts.reduce((a, c, i) => (i === best ? a : a + c), 0);
      rows.push(counts[best] >= 40 && counts[best] < 600 && counts[best] > 3 * others ? best + 1 : 0);
    }
    if (rows[0] && rows[0] === rows[1]) { return rows[0]; }
    await sleep(60);
  }
  return 0;
}

async function main() {
  // The loose GAME.CON of part 3: the shareware GRP's, with the player ending the episode three seconds into the level.
  const grp = t.readGrp(t.GRP);
  let con = grp['GAME.CON'].toString('latin1');
  const actor = con.indexOf('actor APLAYER 100 PSTAND 0 0');
  const at = con.indexOf('ifaction 0 action PSTAND', actor);
  if (actor < 0 || at < 0) { throw new Error("GAME.CON has no 'actor APLAYER ... ifaction 0 action PSTAND' to put the test's line after"); }
  const eol = con.indexOf('\n', at);
  con = con.slice(0, eol + 1) + '    ifcount 90 { endofgame 52 resetcount }   // test: end the episode after 3 s\n' + con.slice(eol + 1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jfd-loops-'));
  const conFile = path.join(dir, 'game.con');
  fs.writeFileSync(conFile, con, 'latin1');
  const env = await t.start(PORT, { '/f/game.con': conFile });
  try {
    // --- 1. the intro, and 2. New Game ------------------------------------------------------------------
    {
      const { page, context, errors } = await t.open(env, '?test=1&persist=0');
      const decoder = await context.newPage();
      await t.waitState(page, 'ready');
      await page.click('#start');
      console.log('1. Logo(): the 3D Realms screen, the title screen');
      const ws = [];
      for (let i = 0; i < 5; i++) { ws.push(await window_(page, 3000)); }   // from about 0 to 15 s after the click
      ws.forEach((w, i) => t.check(okWindow(w), `intro, seconds ${3 * i} to ${3 * i + 3}: the page is responsive and the game yields (${describe(w)})`));
      let row = 0;
      for (let i = 0; i < 12 && !row; i++) { await sleep(1000); row = await menuUp(page, decoder); }
      t.check(row === 1, `the intro ends by itself and the main menu is up (row ${row})`);
      console.log('2. New Game: the skill voice, the level loading');
      for (let i = 0; i < 3; i++) { await key(page, 'Enter', 150); await sleep(1100); }
      const nw = [];
      for (let i = 0; i < 4; i++) { nw.push(await window_(page, 3000)); }
      nw.forEach((w, i) => t.check(okWindow(w), `after New Game, seconds ${3 * i} to ${3 * i + 3}: the page is responsive and the game yields (${describe(w)})`));
      let hp = 0;
      for (let i = 0; i < 20 && hp < 100; i++) { hp = await t.redPixels(page, { x: 60, y: 640, width: 100, height: 70 }); if (hp < 100) { await sleep(500); } }
      t.check(hp >= 100, `the level was loaded: the status bar is up (${hp} red pixels in the health box)`);
      t.check(errors.length === 0, 'no page error', errors.join(' | '));
      await decoder.close();
      await context.close();
    }

    // --- 3. the end of episode 1 ------------------------------------------------------------------------
    {
      console.log('3. the end of episode 1: dobonus(), userack(), the order pages');
      const { page, context, errors } = await t.open(env, '?test=1&persist=0&files=' + encodeURIComponent('/f/game.con') + '&args=' + encodeURIComponent('-v1 -l1 -s1'));
      const decoder = await context.newPage();
      await t.waitState(page, 'ready');
      await page.click('#start');
      await sleep(4000);
      const log0 = await page.evaluate(() => window.jfswOut.join('\n'));
      t.check(/Compiling: game\.con \(\d+ bytes\)/.test(log0) && !/Compiling: game\.con \(99639 bytes\)/.test(log0), 'the game compiled the loose GAME.CON of the test (not the GRP\'s)');
      // Until the end sequence: 3 s of play, then endofgame's countdown. Stages are told apart by the picture (the animation has black
      // bars at the top; the story and completed screens have text there); what the test asserts is that each stage is responsive, stays
      // until a key (so nothing ends by itself early), and that a key moves on, back to the main menu.
      let stage = 0, row = 0, waitedForEnd = false;
      const seen = [];
      for (let i = 0; i < 30 && !row; i++) {
        const w = await window_(page, 2000);
        seen.push(w);
        row = await menuUp(page, decoder);
        if (row) { break; }
        // the first windows are the level; the end sequence starts about 5 s in. Press a key once a window has passed since the last.
        if (i >= 3) { await key(page, 'KeyA', 120); stage++; }
      }
      const bad = seen.filter((w) => !okWindow(w));
      t.check(bad.length === 0, `every stage of the end sequence is responsive and yields (${seen.length} windows of 2 s; worst gap ${Math.round(Math.max(...seen.map((w) => w.gap)))} ms, fewest yields ${Math.round(Math.min(...seen.map((w) => w.yields)))} a second)`, bad.map(describe).join(' | '));
      t.check(row === 1, `the sequence ends back in the main menu after ${stage} key presses (row ${row})`);
      t.check(stage >= 5, `it took several keys, one for each part of the sequence (${stage} presses: the animation, the story, the completed screen, the order pages)`);
      t.check((await page.evaluate(() => window.jfswState)) === 'running', 'the game is still running at the end');
      t.check(errors.length === 0, 'no page error', errors.join(' | '));
      await decoder.close();
      await context.close();
    }
  } finally {
    await t.stop(env);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return t.summary('loops');
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
