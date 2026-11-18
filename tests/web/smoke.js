#!/usr/bin/env node
// Browser smoke test for the Emscripten build (brief 02, test 1). Ported from jfSW's smoke.js.
//
//   node tests/web/smoke.js            # uses build-wasm/ and testdata/duke3dshare.grp
//   WASM_DIR=build-wasm-debug node tests/web/smoke.js
//   SMOKE_SABOTAGE=blank node tests/web/smoke.js   # hides the canvas: the picture checks must FAIL
//   SMOKE_SABOTAGE=nokey node tests/web/smoke.js   # presses no key: the checks that need one must FAIL
//   SMOKE_SABOTAGE=noesc node tests/web/smoke.js   # the pointer is released like the game does it: the Escape check must FAIL
//   SMOKE_SABOTAGE=unlockedmouse node tests/web/smoke.js   # mouse motion reaches the game while unlocked: the view check must FAIL
//   SMOKE_SABOTAGE=slowclock node tests/web/smoke.js        # the game's clock runs at a fifth of the speed: the intro cannot end in time
//   SMOKE_SABOTAGE=noquit node tests/web/smoke.js           # the quit never gets its Y: the game must not be reported as ended
//   SMOKE_SHOT=file.png                            # also save a screenshot of the page
//
// Loads the page with ?test=1, clicks "Click to start" and plays the way a person does: the intro (it ends by itself, and a
// key skips it), the main menu (the keyboard drives it), New Game to a level (the skill voice is waited for), the level (the
// keyboard moves the player, Escape opens the menu, the pointer lock) and quitting (the shareware order screens, then the
// page's "The game has ended."). The picture is read as the browser composites it (an element screenshot): a WebGL canvas
// read back directly is blank. The test proves its own blank check first, on pictures that are known to be blank.
'use strict';
const t = require('./lib.js');

const PORT = t.port(49101);
const SAB = process.env.SMOKE_SABOTAGE || '';
const SABOTAGE = SAB === 'blank';
const SABOTAGE_NOESC = SAB === 'noesc';   // release the pointer the way the game does: no Escape reaches it, that check must FAIL
const SABOTAGE_NOKEY = SAB === 'nokey';   // do not press the keys: the checks that need a key must FAIL
const SABOTAGE_UNLOCKEDMOUSE = SAB === 'unlockedmouse';   // let unlocked mouse motion reach the game: the view check must FAIL
const SABOTAGE_SLOWCLOCK = SAB === 'slowclock';           // the clock the game reads runs at 1/5: the timed intro cannot end in time
const SABOTAGE_NOQUIT = SAB === 'noquit';                 // the quit's Y is never pressed: the end check must FAIL

// A key the game's polling loops are sure to see, unless the nokey sabotage is on.
async function key(page, k, ms) { if (!SABOTAGE_NOKEY) { await t.tap(page, k, ms); } else { await page.waitForTimeout((ms || 200)); } }

const { cursorFinder } = t;   // lib.js: finds the main menu's cursor row

async function main() {
  const env = await t.start(PORT);
  try {
    // --- 1. The blank check must be able to fail -------------------------------------------------------
    {
      const { page, context } = await t.open(env, '?test=1&persist=0');
      await t.waitState(page, 'ready');
      await page.evaluate(() => { document.getElementById('overlay').hidden = true; });   // the overlay is not the canvas
      const before = await t.canvasStats(page);
      await page.evaluate(() => { document.getElementById('overlay').hidden = false; });
      t.check(!t.notBlank(before), 'blank check: the canvas before the game starts counts as blank', JSON.stringify(before));
      // A canvas filled with one colour, and one with two, are blank too; a canvas with 12 colours is not.
      const mk = async (n) => {
        const side = await context.newPage();
        const png = await side.evaluate((colors) => {
          const c = document.createElement('canvas'); c.width = 640; c.height = 480;
          const g = c.getContext('2d');
          for (let i = 0; i < colors; i++) { g.fillStyle = `rgb(${i * 20},${255 - i * 20},${i * 7})`; g.fillRect(i * 50, 0, 50, 480); }
          return c.toDataURL('image/png').split(',')[1];
        }, n);
        await side.close();
        return t.analysePng(page, Buffer.from(png, 'base64'));
      };
      t.check(!t.notBlank(await mk(1)), 'blank check: a single-colour picture counts as blank');
      t.check(!t.notBlank(await mk(2)), 'blank check: a two-colour picture counts as blank');
      t.check(t.notBlank(await mk(12)), 'blank check: a 12-colour picture is not blank');
      await context.close();
    }

    // --- 2. The intro on its own, then the main menu ------------------------------------------------------
    {
      const { page, context, errors } = await t.open(env, '?test=1&persist=0');
      if (SABOTAGE_SLOWCLOCK) { await page.addInitScript(t.warpScript(0.2)); await page.reload(); }
      const consoleErrors = [];
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      const decoder = await context.newPage();
      const cursorRow = cursorFinder(page, decoder);

      t.check((await t.waitState(page, 'ready')) === 'ready', 'page loads the data and offers "Click to start"');
      t.check(await page.isVisible('#start'), 'the start button is visible');
      await page.click('#start');
      t.check((await page.evaluate(() => window.jfswState)) === 'running', 'the click starts the game');

      // The first screen is the 3D Realms logo, held for 7 seconds.
      let stats = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 90000) {
        stats = await t.canvasStats(page);
        if (t.notBlank(stats)) { break; }
        await page.waitForTimeout(500);
      }
      if (SABOTAGE) { await page.evaluate(() => { document.getElementById('canvas').style.opacity = '0'; }); }
      stats = await t.canvasStats(page);
      t.check(t.notBlank(stats), `the canvas is not blank (${stats.colors} colours, ${stats.width}x${stats.height})`, JSON.stringify(stats));
      if (SABOTAGE) { await page.evaluate(() => { document.getElementById('canvas').style.opacity = ''; }); }

      // With no key pressed the intro ends by itself: Logo() (src/game.c) waits 7 s on the logo and 8.2 s on the title
      // screen, in loops that poll the game's clock and call handleevents() and nextpage(), and the main menu follows.
      // The click was the start; give it up to 30 s (a clock that runs slow, or a loop that never gets its turn, misses).
      const started = Date.now();
      let r = { row: 0, counts: '' };
      while (Date.now() - started < 30000 && !r.row) { await page.waitForTimeout(1000); r = await cursorRow(); }
      const took = Math.round((Date.now() - t0) / 1000);
      t.check(r.row === 1, `the intro ends by itself and the main menu is up, with the cursor on New Game (${took} s after the click; row ${r.row}; light pixels per row ${r.counts})`);

      // The keyboard drives the menu: Down moves the cursor down, Up moves it up (the list wraps round). The menu reads the
      // arrows' state, not presses, and a 150 ms press spans one or two of its looks: one or two rows, never none, never three.
      const press = async (k) => { await key(page, k, 150); await page.waitForTimeout(500); return cursorRow(); };
      const steps = (from, to) => (to - from + 6) % 6;      // rows moved down, with the wrap
      const c0 = r;
      const c1 = await press('ArrowDown');
      t.check(c0.row && c1.row && [1, 2].includes(steps(c0.row, c1.row)), `Down moves the menu cursor down (row ${c0.row} to ${c1.row}; light pixels per row ${c1.counts})`);
      const c2 = await press('ArrowUp');
      t.check(c1.row && c2.row && [1, 2].includes(steps(c2.row, c1.row)), `Up moves it up (row ${c1.row} to ${c2.row}; light pixels per row ${c2.counts})`);
      t.check(t.notBlank(await t.canvasStats(page)), 'the menu is still drawn after the key presses');

      // The game goes on running: frames keep being presented.
      const frames = await page.evaluate(() => Module.jfswFrameLog.length);
      await page.waitForTimeout(1000);
      const frames2 = await page.evaluate(() => Module.jfswFrameLog.length);
      t.check(frames2 - frames > 20, `frames keep coming (${frames2 - frames} in a second)`);

      // Sound: the audio device was opened after the click, and its clock runs.
      const audio = async () => page.evaluate(() => { const c = Module.SDL2 && Module.SDL2.audioContext; return c ? { state: c.state, time: c.currentTime, open: !!Module.SDL2.audio } : null; });
      const a1 = await audio();
      await page.waitForTimeout(1000);
      const a2 = await audio();
      t.check(a1 && a1.open && a1.state === 'running', `the game opened its audio device and the AudioContext is running (${a1 && a1.state})`);
      t.check(a1 && a2 && a2.time > a1.time, 'the audio clock advances');
      // Mouse: a click on the picture captures the pointer (the game uses relative mouse mode).
      await page.mouse.click(500, 300);
      await page.waitForTimeout(500);
      t.check(await page.evaluate(() => document.pointerLockElement === document.getElementById('canvas')), 'a click on the picture locks the pointer');
      t.check((await page.evaluate(() => window.jfswState)) === 'running', 'the game is still running');
      t.check(errors.length === 0, 'no uncaught page error, dialog or alert', errors.join(' | '));
      t.check(consoleErrors.length === 0, 'no console.error', consoleErrors.slice(0, 3).join(' | '));
      const log = await page.evaluate(() => window.jfswOut.join('\n'));
      t.check(/GRP file: duke3d\.grp/.test(log) && /Unregistered Shareware/.test(log), 'the game found the shareware GRP');
      t.check(!/out of sync|Error|ERROR|Missing/.test(log), 'no error text in the game output');
      if (process.env.SMOKE_SHOT) { await page.screenshot({ path: process.env.SMOKE_SHOT }); }
      await decoder.close();
      await context.close();
    }

    // --- 3. A key skips the intro; New Game; the level; Escape; quitting ----------------------------------------
    {
      const { page, context, errors } = await t.open(env, '?test=1&persist=0');
      const decoder = await context.newPage();
      const cursorRow = cursorFinder(page, decoder);
      await t.waitState(page, 'ready');
      await page.click('#start');
      // A letter key skips each intro screen (KB_KeyWaiting() sees it) and does nothing in the main menu. (Shift, Ctrl and
      // the arrows are not "waiting" keys: the screen stays. Space and Enter would select in the menu.) The two screens
      // take 15 s on their own: with a key for each, the menu is up in a few seconds.
      const skipStart = Date.now();
      let r = { row: 0, counts: '' };
      for (let i = 0; i < 20 && !r.row && Date.now() - skipStart < 9000; i++) { await key(page, 'KeyA', 100); await page.waitForTimeout(500); r = await cursorRow(); }
      t.check(r.row === 1, `a key skips each intro screen: the main menu is up ${Math.round((Date.now() - skipStart) / 100) / 10} s after the click (row ${r.row})`);
      await decoder.close();

      // New Game, the episode and the skill: Enter three times. Choosing the skill plays the skill's voice and newgame()
      // waits for it to end (issoundplaying(), src/premap.c), so this needs the audio mixer to run.
      for (let i = 0; i < 3; i++) { await key(page, 'Enter', 150); await page.waitForTimeout(1200); }
      let lvl = 0;
      for (let i = 0; i < 40 && lvl < 100; i++) { await page.waitForTimeout(500); lvl = await t.redPixels(page, { x: 60, y: 640, width: 100, height: 70 }); }
      t.check(lvl >= 100, `New Game starts a level: the status bar is up (${lvl} red pixels in the health box)`);
      await page.waitForTimeout(1500);
      const VIEW = { x: 20, y: 10, width: 960, height: 590 };   // the 3D view above the status bar
      const still = await t.changedPixels(page, VIEW, null, 800);
      const moved = await t.changedPixels(page, VIEW, () => key(page, 'ArrowUp', 600), 200);
      t.check(moved > 30000 && moved > 3 * still, `the keyboard moves the player (${moved} pixels changed with Up held; ${still} by themselves)`);
      const frames = await page.evaluate(() => Module.jfswFrameLog.length);
      await page.waitForTimeout(1000);
      t.check((await page.evaluate(() => Module.jfswFrameLog.length)) - frames > 20, 'frames keep coming in the level');

      // Escape opens the game's menu, and again closes it.
      const MENU = { x: 150, y: 110, width: 520, height: 380 };    // where the menu text appears
      const opened0 = await t.changedPixels(page, MENU, () => key(page, 'Escape', 150), 800);
      t.check(opened0 > 45000, `Escape opens the game's menu (${opened0} pixels changed; ${still} by themselves)`);
      const closed0 = await t.changedPixels(page, MENU, () => key(page, 'Escape', 150), 800);
      t.check(closed0 > 45000, `Escape closes it (${closed0} pixels changed)`);

      // Escape and the pointer. When the browser takes the pointer (the user pressed Escape; the key itself never reaches the
      // page) the game must still get an Escape: its menu opens. A deliberate release by the game must not.
      const lock = async () => {
        for (let i = 0; i < 5 && !(await page.evaluate(() => !!document.pointerLockElement)); i++) { await page.mouse.click(500, 300); await page.waitForTimeout(500); }
        return page.evaluate(() => document.pointerLockElement === document.getElementById('canvas'));
      };
      t.check(await lock(), 'in a level, a click locks the pointer');
      await page.waitForTimeout(2000);    // the click also fired the pistol
      const byItself = await t.changedPixels(page, MENU, null, 800);
      // (a) the game itself lets go of the pointer: no Escape is sent, nothing opens
      const ctrl = await t.changedPixels(page, MENU, () => page.evaluate(() => document.exitPointerLock()), 800);
      t.check(ctrl < 30000, `a release asked for by the game does not open the menu (${ctrl} pixels changed; ${byItself} by themselves)`);
      t.check(!(await page.evaluate(() => !!document.pointerLockElement)), 'the pointer was released');
      // (a2) with the pointer released, the mouse is not the game's: moving it over the picture must not turn the view.
      // (SDL keeps relative mode on and turns absolute positions into relative motion when the pointer is not locked.)
      const sweep = async () => { await page.mouse.move(200, 250, { steps: 4 }); await page.mouse.move(800, 350, { steps: 8 }); await page.mouse.move(500, 300, { steps: 4 }); };
      const swept = await t.changedPixels(page, VIEW, SABOTAGE_UNLOCKEDMOUSE ? () => page.evaluate(() => { window.jfswTest.passUnlockedMouse = true; }).then(sweep) : sweep, 800);
      t.check(swept < 2000, `moving the mouse while the pointer is released does not turn the view (${swept} pixels changed)`);
      t.check(await lock(), 'a click locks the pointer again');
      await page.waitForTimeout(2000);
      // (b) the browser takes the pointer (as for Escape): the page passes an Escape on and the menu opens
      const opened = await t.changedPixels(page, MENU, () => page.evaluate((real) => (real ? Document.prototype.exitPointerLock.call(document) : document.exitPointerLock()), !SABOTAGE_NOESC), 1200);
      t.check(opened > 45000, `when the browser takes the pointer (as Escape does) the game's menu opens (${opened} pixels changed)`);
      // close it again for the quit below (only if it opened: Escape would open it otherwise)
      if (opened > 45000) { await key(page, 'Escape', 150); }
      await page.waitForTimeout(800);

      // Quit: F10, then Y; the shareware game shows two order screens that wait for a key each (userack(), src/game.c).
      await key(page, 'F10', 150); await page.waitForTimeout(1000);
      if (!SABOTAGE_NOQUIT) { await key(page, 'y', 150); }
      let state = '';
      for (let i = 0; i < 14 && !['ended', 'error'].includes(state); i++) {
        await page.waitForTimeout(1200);
        state = await page.evaluate(() => window.jfswState);
        if (!['ended', 'error'].includes(state) && !SABOTAGE_NOQUIT) { await key(page, 'KeyA', 100); }
      }
      t.check(state === 'ended', `quitting ends the game and the page says so (state ${state})`);
      const end = await page.evaluate(() => ({ status: document.getElementById('status').textContent, exit: window.jfswExit, reload: !document.getElementById('reload').hidden }));
      t.check(/The game has ended\./.test(end.status) && end.exit && end.exit.code === 0 && end.reload, `the overlay says "${end.status}", exit status ${end.exit && end.exit.code}, a reload button`);
      t.check(errors.length === 0, 'no page error in the level', errors.join(' | '));
      await context.close();
    }
  } finally {
    await t.stop(env);
  }
  return t.summary('smoke');
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
