#!/usr/bin/env node
// F4 in a game opens the sound menu, and Escape gets the player back (brief F-D3, bugs.md D3). Chromium.
//
//   node tests/web/menu-keys.js                 # uses build-wasm/ and testdata/duke3dshare.grp
//   WASM_DIR=build-wasm-nofix node tests/web/menu-keys.js   # a build from before the fix (F4 called cmenu(701), which menus() did not know): must FAIL
//   MENUKEYS_SABOTAGE=nokey node tests/web/menu-keys.js      # presses no F4: the checks that need the menu must FAIL
//
// Before the fix F4 left the game in a menu state that nothing drew and nothing closed: the picture stayed the plain level,
// the player could not move, and Escape did nothing. The test has two witnesses for the menu, and wants both:
//   - the game's own account: with -testmenu (src/testhooks.c) it prints "TEST: menu N" whenever the menu of a game opens,
//     changes or closes (N is current_menu, -1 for no menu): F4 gives 701, Escape gives -1;
//   - the picture: the sound menu's text is red, and the red pixels where it is drawn are counted before F4, after F4 and
//     after Escape (the picture is read as the browser composites it, as in smoke.js).
// And one for being back in the game: with the menu closed, holding Up turns the picture over (the 3D view changes by
// tens of thousands of pixels, against a few hundred when standing still).
// Then the sound menu is reached the other way, through Escape, Options and Sound (menu 700), where Escape and Escape and
// Escape still lead back one step at a time (700, 200, 50, none): the fix must not change that path.
// Port 49107. The level is E1L1 with -v1 -l1 -s1 (as focus.js).
'use strict';
const t = require('./lib.js');

const PORT = t.port(49107);
const NOKEY = process.env.MENUKEYS_SABOTAGE === 'nokey';
const VIEW = { x: 20, y: 10, width: 960, height: 590 };     // the 3D view above the status bar (viewport 1000x800)
const TEXT = { x: 130, y: 150, width: 430, height: 390 };   // where the sound menu's red names are drawn
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function key(page, k, ms) { if (!NOKEY || k !== 'F4') { await t.tap(page, k, ms || 150); } else { await sleep(ms || 150); } }

// The "TEST: menu N" lines so far, as numbers.
const menus = (page) => page.evaluate(() => window.jfswOut.filter((l) => /^TEST: menu /.test(l)).map((l) => +l.slice(11)));
const lastMenu = async (page) => { const m = await menus(page); return m.length ? m[m.length - 1] : null; };
// Waits (up to ms) for the game to report menu `want` as its last; returns what it last reported.
async function waitMenu(page, want, ms) {
  const t0 = Date.now();
  let m = await lastMenu(page);
  while (m !== want && Date.now() - t0 < (ms || 3000)) { await sleep(100); m = await lastMenu(page); }
  return m;
}

async function main() {
  const env = await t.start(PORT);
  try {
    const { page, context, errors } = await t.open(env, '?test=1&persist=0&args=' + encodeURIComponent('-testmenu -v1 -l1 -s1'));
    t.check((await t.waitState(page, 'ready')) === 'ready', 'the page is ready');
    await page.click('#start');
    let lvl = 0;
    for (let i = 0; i < 80 && lvl < 100; i++) { await sleep(500); lvl = await t.redPixels(page, { x: 60, y: 640, width: 100, height: 70 }); }
    t.check(lvl >= 100, `a level is running: the status bar is up (${lvl} red pixels in the health box)`);
    await sleep(2000);
    t.check((await lastMenu(page)) === -1, 'the game reports no menu');

    // The control: the keyboard moves the player, and the sound menu's text is not on the level picture.
    const still = await t.changedPixels(page, VIEW, null, 800);
    const moved0 = await t.changedPixels(page, VIEW, () => key(page, 'ArrowUp', 600), 200);
    t.check(moved0 > 30000 && moved0 > 3 * still, `the keyboard moves the player (${moved0} pixels changed with Up held; ${still} by themselves)`);
    const red0 = await t.redPixels(page, TEXT);

    // F4, twice (the second time proves that the first left nothing behind).
    for (const round of [1, 2]) {
      await key(page, 'F4', 150);
      const m = await waitMenu(page, 701);
      t.check(m === 701, `round ${round}: F4 opens the sound menu (the game reports menu ${m})`);
      await sleep(800);
      const red1 = await t.redPixels(page, TEXT);
      t.check(red1 > red0 + 4000, `round ${round}: the sound menu is drawn (${red1} red pixels where its names are, ${red0} before)`);
      // the picture is the menu's, and it is still being drawn
      const frames = await page.evaluate(() => Module.jfswFrameLog.length);
      await sleep(800);
      t.check((await page.evaluate(() => Module.jfswFrameLog.length)) - frames > 15, `round ${round}: frames keep coming while the menu is up`);

      await key(page, 'Escape', 150);
      const m2 = await waitMenu(page, -1);
      t.check(m2 === -1, `round ${round}: Escape closes the menu and the game is back (the game reports menu ${m2})`);
      await sleep(800);
      const red2 = await t.redPixels(page, TEXT);
      t.check(red2 < red0 + 3000, `round ${round}: the menu's text is gone from the picture (${red2} red pixels)`);
      const moved = await t.changedPixels(page, VIEW, () => key(page, 'ArrowUp', 600), 200);
      t.check(moved > 30000 && moved > 3 * still, `round ${round}: the player can move again (${moved} pixels changed with Up held)`);
    }

    // F4, then a change in the menu: it takes keys (S: Sound is the first line; Enter turns it off and on again).
    await key(page, 'F4', 150);
    t.check((await waitMenu(page, 701)) === 701, 'F4 opens the sound menu a third time');
    await sleep(600);
    const ONOFF = { x: 720, y: 140, width: 150, height: 60 };     // the ON or OFF of the Sound line
    const idle = await t.changedPixels(page, ONOFF, null, 600);   // (the game is paused behind the menu: nothing moves)
    const flipped = await t.changedPixels(page, ONOFF, () => key(page, 'Enter', 150), 600);
    t.check(flipped > 500 && flipped > idle + 500, `the menu answers keys: Enter on Sound changes ON to OFF (${flipped} pixels changed; ${idle} by themselves)`);
    await key(page, 'Enter', 150);
    await sleep(600);
    await key(page, 'Escape', 150);
    t.check((await waitMenu(page, -1)) === -1, 'Escape closes it');
    await sleep(600);

    // The other way in, which must be unchanged: Escape (the game menu, 50), Options (O, Enter: 200), Sound (S, Enter: 700);
    // then Escape three times, one step each. (A menu hotkey moves the cursor and Enter chooses: bugs.md D4.)
    const steps = [['Escape', 50], ['KeyO', 50], ['Enter', 200], ['KeyS', 200], ['Enter', 700], ['Escape', 200], ['Escape', 50], ['Escape', -1]];
    let ok = true, trail = '';
    for (const [k, want] of steps) {
      await key(page, k, 150);
      const m = await waitMenu(page, want, 2500);
      trail += `${k}:${m} `;
      if (m !== want) { ok = false; break; }
      await sleep(500);
    }
    t.check(ok, 'Escape, O, Enter, S, Enter reach Options and Sound (menu 700), and Escape goes back one step at a time (700, 200, 50, none)', trail);
    await sleep(600);
    const moved2 = await t.changedPixels(page, VIEW, () => key(page, 'ArrowUp', 600), 200);
    t.check(moved2 > 30000 && moved2 > 3 * still, `the player can move at the end (${moved2} pixels changed with Up held)`);

    const state = await page.evaluate(() => window.jfswState);
    t.check(state === 'running', `the game is still running (state ${state})`);
    t.check(errors.length === 0, 'no page error', errors.join(' | '));
    await context.close();
  } finally {
    await t.stop(env);
  }
  return t.summary('menu-keys');
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
