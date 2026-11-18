#!/usr/bin/env node
// The page in a stock Firefox (brief 02c, bugs.md L24): a refused pointer lock does not end the game.
//
//   scripts/setup-firefox.sh                 # once: a pinned Firefox and puppeteer-core, in ~/.cache/jfduke3d-browser
//   node tests/web/firefox.js                # uses build-wasm/ and testdata/duke3dshare.grp
//   FIREFOX=/usr/bin/firefox node tests/web/firefox.js           # another Firefox (Arch: the packaged one)
//   FIREFOX_SABOTAGE=unhandled node tests/web/firefox.js         # the lock's promise left unhandled, as before the fix: must FAIL
//   WASM_DIR=other node tests/web/firefox.js                     # another build (one from before the fix must FAIL)
//   FIREFOX_ONLY=2 node tests/web/firefox.js                     # only part 2
//
// Not part of the default runs: it needs a Firefox that the other tests do not. Without one it prints "NOT RUN" and
// exits with status 3; that is not a pass.
//
// Headless Firefox never gives the page the focus (document.hasFocus() is false), so it refuses every pointer-lock
// request: "The document is not focused.", as a desktop Firefox does after Alt+Tab. Its DOMException has a stack
// through duke3d.js, which before the fix made the page show "Something went wrong" (the user's report). The game asks
// for the lock at start-up (grabmouse(1) in jfbuild/src/sdlayer2.c) and on every click on the canvas.
// 1. A single player game: the refusal at start-up and after a click are logged, the game keeps running, no overlay.
// 2. A wasm trap in the game's frame is still fatal in Firefox, with ?persist=0 and with persistence on.
// (jfSW's parts 3 and 4, network games through a relay, belong to brief 04 and later: not here.)
// Port: 49400 (page).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const t = require('./lib.js');
const { serve } = require('./server.js');

const FIREFOX_VERSION = '160.0', PUPPETEER_VERSION = '25.17.0';   // as scripts/setup-firefox.sh installs them
const CACHE = process.env.FIREFOX_CACHE || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'jfduke3d-browser');
const FIREFOX = process.env.FIREFOX || path.join(CACHE, 'firefox-' + FIREFOX_VERSION, 'firefox', 'firefox');
const PUPPETEER = process.env.PUPPETEER_CORE || path.join(CACHE, 'puppeteer-core-' + PUPPETEER_VERSION, 'node_modules', 'puppeteer-core');
const PORT_WEB = t.port(49400);   // (JFDUKE3D_WEB_PORT_OFFSET, lib.js)
const ONLY = process.env.FIREFOX_ONLY || '';
const SABOTAGE = process.env.FIREFOX_SABOTAGE === 'unhandled';
const MSG = 'The document is not focused.';
// Single player games start in a level: in headless Firefox, which plays no sound, the title sequence stops drawing
// after a few seconds (it waits for its sound), so frames would stop coming there for a reason of its own.
const LEVEL = '?test=1&persist=0&args=' + encodeURIComponent('-v1 -l1 -s1');
const LEVEL_PERSIST = '?test=1&args=' + encodeURIComponent('-v1 -l1 -s1');      // the game's folder kept in IndexedDB, as on a real page
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function notRun(why) {
  console.log('firefox: NOT RUN: ' + why);
  console.log('  (scripts/setup-firefox.sh installs a pinned Firefox and puppeteer-core; FIREFOX=/path/to/firefox uses another Firefox)');
  process.exit(3);
}
// The cache holds other versions than the ones this test pins (scripts/setup-firefox.sh was changed, or not run since).
function versionMismatch(what, want, dirPrefix) {
  let have = [];
  try { have = fs.readdirSync(CACHE).filter((d) => d.startsWith(dirPrefix)).map((d) => d.slice(dirPrefix.length)); } catch (e) { /* no cache */ }
  if (!have.length) { return; }
  console.log(`firefox: VERSION MISMATCH: this test wants ${what} ${want}, the cache (${CACHE}) has ${have.join(', ')}`);
  console.log('  (run scripts/setup-firefox.sh; or FIREFOX=/path/to/firefox, PUPPETEER_CORE=/path/to/puppeteer-core to use others)');
  process.exit(3);
}

// Before the page's scripts: count what the browser does with pointer-lock requests, and unhandled rejections.
function watchLocks() {
  window.__ff = { lockErrors: 0, lockChanges: 0, unhandled: 0 };
  document.addEventListener('pointerlockerror', () => { window.__ff.lockErrors++; });
  document.addEventListener('pointerlockchange', () => { window.__ff.lockChanges++; });
  window.addEventListener('unhandledrejection', () => { window.__ff.unhandled++; }, true);
}

async function launchFirefox(puppeteer) {
  return puppeteer.launch({
    browser: 'firefox', executablePath: FIREFOX, headless: true, defaultViewport: null, args: ['--width=1000', '--height=800'],
    // a persistent-storage prompt (the data cache of brief 03 will ask for persistent storage) answered without a doorhanger
    extraPrefsFirefox: { 'dom.storageManager.prompt.testing': true, 'dom.storageManager.prompt.testing.allow': true },
  });
}
// The browser's first tab (each part has a Firefox of its own).
async function firefoxPage(browser, url) {
  const page = (await browser.pages())[0] || await browser.newPage();
  const warnings = [], errors = [];
  page.on('console', (m) => { if (m.type() === 'warn' || m.type() === 'warning') { warnings.push(m.text()); } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + ((e && e.message) || e)));
  await page.evaluateOnNewDocument(watchLocks);
  await page.goto(url);
  await page.waitForFunction(() => window.jfswState === 'ready' || window.jfswState === 'error', { timeout: 120000, polling: 200 });
  if (SABOTAGE) { await page.evaluate(() => { window.jfswTest.unhandledPointerLock = true; }); }
  return { page, warnings, errors };
}
const pageState = (page) => page.evaluate(() => ({
  state: window.jfswState, overlay: !document.getElementById('overlay').hidden, status: document.getElementById('status').textContent,
  frames: Module.jfswFrameLog.length, focus: document.hasFocus(), ff: window.__ff,
}));

async function single(puppeteer, base) {
  const browser = await launchFirefox(puppeteer);
  try { await singleIn(browser, base); } finally { await browser.close().catch(() => {}); }
}
async function singleIn(browser, base) {
  console.log('1. single player' + (SABOTAGE ? ' (SABOTAGE: the promise is left unhandled, as before the fix)' : ''));
  const { page, warnings, errors } = await firefoxPage(browser, base + LEVEL);
  await page.click('#start');
  await sleep(6000);
  let s = await pageState(page);
  t.check(!s.focus, 'headless Firefox: the page does not have the focus (so every pointer-lock request is refused)');
  t.check(s.ff.lockErrors >= 1 && s.ff.lockChanges === 0, `the game asked for the lock at start-up and Firefox refused (${s.ff.lockErrors} refusals)`);
  t.check(s.state === 'running' && !s.overlay, `the game is still running, no overlay (state ${s.state})`, s.status);
  t.check(warnings.some((w) => w.indexOf('pointer lock refused: ' + MSG) >= 0), 'the refusal is logged ("pointer lock refused: ' + MSG + '")', warnings.slice(0, 3).join(' | '));
  const f0 = s.frames;
  await sleep(2000);
  s = await pageState(page);
  t.check(s.frames - f0 > 10, `frames keep coming (${s.frames - f0} in 2 s)`);
  const refusals = s.ff.lockErrors;
  const box = await (await page.$('#canvas')).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(1500);
  s = await pageState(page);
  t.check(s.ff.lockErrors > refusals, `a click on the canvas asks again, and is refused again (${refusals} to ${s.ff.lockErrors} refusals)`);
  t.check(s.state === 'running' && !s.overlay, `still running, no overlay (state ${s.state})`, s.status);
  t.check(s.ff.unhandled === 0 && errors.length === 0, `no unhandled rejection or page error (${s.ff.unhandled})`, errors.join(' | '));
  if (s.overlay) { console.log('  (the page said: ' + s.status + ')'); }
}

async function trap(puppeteer, base, persist) {
  const browser = await launchFirefox(puppeteer);
  try { await trapIn(browser, base, persist); } finally { await browser.close().catch(() => {}); }
}
// persist: the game's folder kept in IndexedDB (every real page; the exit's save delays "The game has ended.") or not
async function trapIn(browser, base, persist) {
  console.log('2. a wasm trap is still fatal' + (persist ? ' (persistence on)' : ' (?persist=0)'));
  const { page } = await firefoxPage(browser, base + (persist ? LEVEL_PERSIST : LEVEL));
  await page.click('#start');
  await sleep(5000);
  const before = await pageState(page);
  await page.evaluate(() => {      // as focus.js: free() of an address beyond memory, inside the game's frame (sdlayer2.c's EM_JS in duke3d.js)
    let n = Module.jfswShowframes, armed = true;
    Object.defineProperty(Module, 'jfswShowframes', { configurable: true, get() { if (armed) { armed = false; Module._free(HEAPU8.length + 4096); } return n; }, set(v) { n = v; } });
  });
  await sleep(2000);
  const s = await pageState(page);
  t.check(before.state === 'running' && s.state === 'error' && s.overlay && /^(Something went wrong|The game crashed): .*\. Reload the page to try again\.$/.test(s.status) && !/\.\./.test(s.status),
    `a trap in the game's frame shows the overlay ("${s.status}")`);
}

async function main() {
  if (!fs.existsSync(FIREFOX)) {
    if (!process.env.FIREFOX) { versionMismatch('Firefox', FIREFOX_VERSION, 'firefox-'); }
    notRun('no Firefox at ' + FIREFOX);
  }
  let puppeteer;
  try { puppeteer = require(PUPPETEER); } catch (e) {
    if (!process.env.PUPPETEER_CORE) { versionMismatch('puppeteer-core', PUPPETEER_VERSION, 'puppeteer-core-'); }
    notRun('no puppeteer-core at ' + PUPPETEER);
  }
  const version = execSync(JSON.stringify(FIREFOX) + ' --version').toString().trim();
  if (version.indexOf(' ' + FIREFOX_VERSION) < 0) {
    if (!process.env.FIREFOX) {
      console.log(`firefox: VERSION MISMATCH: ${FIREFOX} says "${version}", this test wants ${FIREFOX_VERSION} (run scripts/setup-firefox.sh)`);
      process.exit(3);
    }
    console.log(`(FIREFOX: "${version}", not the pinned ${FIREFOX_VERSION}; the results are for that version)`);
  }
  if (!fs.existsSync(path.join(t.BUILD, 'duke3d.wasm'))) { throw new Error(`${t.BUILD}/duke3d.wasm not found: run scripts/build-wasm.sh`); }
  if (!fs.existsSync(t.GRP)) { throw new Error(`${t.GRP} not found: run scripts/fetch-test-data.sh`); }
  const server = await serve(t.BUILD, { '/duke3dshare.grp': t.GRP }, PORT_WEB);
  const base = 'http://127.0.0.1:' + PORT_WEB + '/index.html';
  try {
    console.log('Firefox: ' + version + ' (' + FIREFOX + ')');
    if (!ONLY || ONLY === '1') { await single(puppeteer, base); }
    if (!ONLY || ONLY === '2') { await trap(puppeteer, base, false); await trap(puppeteer, base, true); }
  } finally {
    await new Promise((r) => server.close(r));
  }
  return t.summary('firefox');
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
