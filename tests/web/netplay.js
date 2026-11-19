#!/usr/bin/env node
// Browser netplay tests (brief 04): browsers (Playwright + Chromium) and native games play bounded
// network games through a local vnet relay, and every machine's own record of every game tic is
// compared byte for byte. Jfsw-browser's tests/web/netplay.js, with Duke's names and numbers.
//
//   node tests/web/netplay.js                      # every scenario, one after the other
//   node tests/web/netplay.js ws hidden-slave      # only these
//   node tests/web/netplay.js --list
//   WASM_DIR=build-wasm-x node tests/web/netplay.js ws    # another build of the page (mutation runs)
//   NETPLAY_GAME=/path/to/duke3d node tests/web/netplay.js ws    # another native binary (mutation runs)
//
// Needs: build-wasm/ (scripts/build-wasm.sh), the native ./duke3d (make), testdata/duke3dshare.grp, Go (the relay is
// built from ext/vnet/relay as tests/net/lib.sh builds it), and Playwright with a Chromium (never run `playwright
// install`). Ports: 127.0.0.1:48400 to 48499, moved up by JFDUKE3D_WEB_PORT_OFFSET if set (native network tests use
// 47400 and up). The tests are real time: run one at a time on a machine that is not busy
// (flock /tmp/jfd-heavy-tests.lock node tests/web/netplay.js ...).
//
// How a game is checked. Every machine runs   -v1 -l1 -c2 -testsync -testquit<N> -testdump<file>   (co-op, E1L1; N game
// tics, then a clean exit). -testdump makes the game write 32 bytes for every game tic (the tic number, the random seed
// and six 32 bit hashes of the whole simulation state: players, sprites, hittype, sectors, walls, the rest; testhooks.c):
// the game's own check compares one byte every tic with -testsync (and one in 8 without), and shows only a difference
// of the sync byte (code-facts section 2.5). The test reads each machine's file, requires at least N records, and
// compares all machines record by record. A machine counts as agreeing only if every record is identical.
//
// The shareware network gate (D14): the test pages are served a config.js that sets allowSharewareNetGames (never the
// address) and the native games are given -allowsharewarenet; the `gate` scenario serves the default config and shows
// the refusal.
'use strict';
const { chromium } = require('playwright');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { serve, configText } = require('./server.js');
const L = require('./lib.js');

const PORT_BASE = +(process.env.NETPLAY_PORT_BASE || L.port(48400));
const PORT_WEB = PORT_BASE, PORT_UDP = PORT_BASE + 1, PORT_HTTP = PORT_BASE + 2, PORT_WT = PORT_BASE + 3, PORT_NONE = PORT_BASE + 92;
const NOMINAL = 30;                       // game tics a second (TICRATE 120, TICSPERFRAME 4)
const REC = 32;                           // bytes per tic in a -testdump file
const check = L.check;
const GAME = path.resolve(process.env.NETPLAY_GAME || path.join(L.root, 'duke3d'));
// the game's own arguments (after --): co-op, E1L1, every machine records every tic
const LEVEL = '-v1 -l1 -c2';
// NETPLAY_STATE=1 adds -teststate to every machine: it also writes <dump>.state, the whole simulation state field by field at the
// start of the level and at tics 1 and 2 (testhooks.c); NETPLAY_STATE=600,1200 adds those tics. When two machines' dumps first
// differ at a tic that has a state dump, the failure names the objects and fields that differ.
const STATE_ARGS = process.env.NETPLAY_STATE ? ['-teststate'].concat(process.env.NETPLAY_STATE.split(',').filter((x) => /^\d+$/.test(x) && +x > 2).map((x) => '-teststate' + x)) : [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

// ---- relay ------------------------------------------------------------------------------------------

function relayBinary() {
  if (process.env.NETPLAY_RELAY) { return path.resolve(process.env.NETPLAY_RELAY); }
  const cache = process.env.JFDUKE3D_CACHE || path.join(os.homedir(), '.cache', 'jfduke3d-browser');
  let rev = 'unknown';
  try { rev = execSync('git -C ' + JSON.stringify(path.join(L.root, 'ext', 'vnet')) + ' rev-parse --short HEAD').toString().trim(); } catch (e) { /* no git */ }
  const bin = path.join(cache, 'vnet-relay-' + rev);
  if (!fs.existsSync(bin)) {
    fs.mkdirSync(cache, { recursive: true });
    const env = Object.assign({}, process.env, { PATH: process.env.PATH + ':/usr/local/go/bin' });
    execSync('go build -o ' + JSON.stringify(bin + '.tmp') + ' ./cmd/vnet-relay', { cwd: path.join(L.root, 'ext', 'vnet', 'relay'), env, stdio: 'inherit' });
    fs.renameSync(bin + '.tmp', bin);
  }
  return bin;
}

// A relay on 127.0.0.1: UDP (native players), WebSocket on /vnet and WebTransport (a development certificate).
async function startRelay(extra) {
  const args = ['-udp', '127.0.0.1:' + PORT_UDP, '-http', '127.0.0.1:' + PORT_HTTP, '-wt', '127.0.0.1:' + PORT_WT, '-dev-cert',
    '-origins', '127.0.0.1:' + PORT_WEB, '-v'].concat(extra || [], (process.env.NETPLAY_RELAY_ARGS || '').split(/\s+/).filter(Boolean));     // (NETPLAY_RELAY_ARGS: extra relay flags, for negative controls)
  const child = spawn(relayBinary(), args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let text = '';
  const relay = { child, log: () => text, cert: '', udp: '127.0.0.1:' + PORT_UDP, ws: 'ws://127.0.0.1:' + PORT_HTTP + '/vnet', wt: 'https://127.0.0.1:' + PORT_WT + '/vnet' };
  child.stdout.on('data', (d) => { text += d; });
  child.stderr.on('data', (d) => { text += d; });
  const t0 = now();
  while (!/^LISTEN /m.test(text)) {
    if (child.exitCode !== null) { throw new Error('the relay exited: ' + text); }
    if (now() - t0 > 15000) { throw new Error('the relay did not start: ' + text); }
    await sleep(50);
  }
  relay.cert = (/wt_cert_sha256=(\S+)/.exec(text) || [])[1] || '';
  relay.stop = async () => { try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { /* gone */ } await sleep(200); try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { /* gone */ } };
  return relay;
}

// ---- machines ---------------------------------------------------------------------------------------
// A machine is a browser page or a native game; both give: out() (what the game printed), dumpSize(), readDump(),
// waitEnd(ms), exitCode(), stop().

let browserEnv = null;      // { server, browser }
// The config.js the page is served with (server.js configText): testMode on (?test=1 pages have their test hooks) and the shareware
// network gate opened, as a LAN deployment would (D14), unless a scenario says otherwise (the gate scenario).
let CONFIG_TEST = true, CONFIG_ALLOW = true;
async function env() {
  if (!browserEnv) {
    if (!fs.existsSync(path.join(L.BUILD, 'duke3d.wasm'))) { throw new Error(L.BUILD + '/duke3d.wasm not found: run scripts/build-wasm.sh'); }
    if (!fs.existsSync(L.GRP)) { throw new Error(L.GRP + ' not found: run scripts/fetch-test-data.sh'); }
    const mounts = { '/duke3dshare.grp': L.GRP };
    const out = path.join(tmp(), 'config-served.js');
    fs.writeFileSync(out, configText(L.BUILD, { testMode: CONFIG_TEST, allowSharewareNetGames: CONFIG_ALLOW }));
    mounts['/config.js'] = out;
    const server = await serve(L.BUILD, mounts, PORT_WEB);
    const browser = await chromium.launch();
    browserEnv = { server, browser, base: 'http://127.0.0.1:' + PORT_WEB + '/index.html' };
  }
  return browserEnv;
}
async function closeEnv() {
  if (!browserEnv) { return; }
  try { await browserEnv.browser.close(); } catch (e) { /* gone */ }
  await new Promise((r) => browserEnv.server.close(r));
  browserEnv = null;
  CONFIG_TEST = true;
  CONFIG_ALLOW = true;
}

const machines = [];
let tmpRoot = null;
function tmp() { if (!tmpRoot) { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jfduke3d-netplay-')); } return tmpRoot; }

function gameArgs(o) {
  // o: { net: [..args after -net..], tics, dump, nudge, extra }
  const a = ['-net'].concat(o.net, ['--']);
  if (o.level !== false) { a.push(...(o.level || LEVEL).split(' ')); }
  if (o.testsync !== false) { a.push('-testsync'); }
  if (o.tics) { a.push('-testquit' + o.tics); }
  // o.state: true (the state at tics 1 and 2 of the level) or a list of more tics (-teststate<T>)
  if (o.dump) { a.push('-testdump' + o.dump); a.push(...(o.state ? ['-teststate'].concat(Array.isArray(o.state) ? o.state.map((t) => '-teststate' + t) : []) : STATE_ARGS)); }
  if (o.nudge) { a.push('-testnudge' + o.nudge); }
  return a.concat(o.extra || []);
}

// A browser machine. o.query adds page parameters (knobs); o.raw is the whole query string as given.
async function browserMachine(name, args, o) {
  o = o || {};
  const e = await env();
  const context = await e.browser.newContext({ viewport: o.viewport || { width: 700, height: 560 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (er) => errors.push('pageerror: ' + er.message));
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss().catch(() => {}); });
  const q = o.raw !== undefined ? o.raw : '?test=1&persist=0&args=' + encodeURIComponent(args.join(' ')) + (o.query || '');
  await page.goto(e.base + q);
  await L.waitState(page, o.ready || 'ready', 60000);
  const m = {
    kind: 'browser', name, page, context, errors, started: 0,
    async start() { await page.click('#start'); m.started = now(); },
    out: () => page.evaluate(() => window.jfswOut.join('\n')).catch(() => ''),
    async state() { return Promise.race([page.evaluate(() => window.jfswState).catch(() => 'gone'), sleep(900).then(() => 'running')]); },
    async dumpSize() {
      return page.evaluate((f) => { try { return window.jfswTest.FS.stat('/persist/' + f).size; } catch (er) { return 0; } }, o.dump || 'd.bin').catch(() => 0);
    },
    async readFile(name) {
      const b64 = await page.evaluate((f) => { const b = window.jfswTest.readFile(f); return b ? btoa(Array.from(b, (c) => String.fromCharCode(c)).join('')) : null; }, name);
      return b64 === null ? null : Buffer.from(b64, 'base64');
    },
    async readDump() { return m.readFile(o.dump || 'd.bin'); },
    async exitCode() { return page.evaluate(() => (window.jfswExit ? window.jfswExit.code : null)).catch(() => null); },
    async status() { return page.evaluate(() => document.getElementById('status').textContent).catch(() => ''); },
    async waitEnd(ms) {
      const t0 = now();
      while (now() - t0 < ms) { const s = await m.state(); if (s === 'ended' || s === 'error') { return s; } await sleep(250); }
      return 'timeout';
    },
    async stop() { try { await context.close(); } catch (er) { /* gone */ } },
  };
  machines.push(m);
  return m;
}

// A native machine (scripts/run-headless.sh). o.impair a VNET_IMPAIR spec; o.game another binary than NETPLAY_GAME or ./duke3d;
// o.noallow: without -allowsharewarenet (the gate scenario).
function nativeMachine(name, args, o) {
  o = o || {};
  const wd = path.join(tmp(), name);
  fs.mkdirSync(wd, { recursive: true });
  const outFile = path.join(wd, '..', name + '.out');
  const envv = Object.assign({}, process.env);
  if (o.impair) { envv.VNET_IMPAIR = o.impair; } else { delete envv.VNET_IMPAIR; }
  const m = {
    kind: 'native', name, wd, started: 0, errors: [],
    async start() {
      const out = fs.openSync(outFile, 'w');
      m.child = spawn(path.join(L.root, 'scripts', 'run-headless.sh'), ['--workdir', wd, '--timeout', String(o.timeout || 400), '--game', o.game || GAME, '--']
        .concat(o.noallow ? [] : ['-allowsharewarenet'], args), { env: envv, stdio: ['ignore', out, out], detached: true });
      m.done = new Promise((r) => m.child.on('exit', (c) => { m.code = c; r(c); }));
      m.started = now();
    },
    out: async () => { try { return fs.readFileSync(outFile, 'utf8'); } catch (e) { return ''; } },
    async state() { return m.code === undefined ? 'running' : (m.code === 0 ? 'ended' : 'error'); },
    async dumpSize() { try { return fs.statSync(path.join(wd, o.dump || 'd.bin')).size; } catch (e) { return 0; } },
    async readFile(name) { try { return fs.readFileSync(path.join(wd, name)); } catch (e) { return null; } },
    async readDump() { return m.readFile(o.dump || 'd.bin'); },
    async exitCode() { return m.code === undefined ? null : m.code; },
    async status() { return ''; },
    async waitEnd(ms) {
      const t0 = now();
      while (now() - t0 < ms) { if (m.code !== undefined) { return m.code === 0 ? 'ended' : 'error'; } await sleep(250); }
      return 'timeout';
    },
    async stop() {
      if (m.child && m.code === undefined) { try { process.kill(-m.child.pid, 'SIGTERM'); } catch (e) { /* gone */ } await Promise.race([m.done, sleep(6000)]); try { process.kill(-m.child.pid, 'SIGKILL'); } catch (e) { /* gone */ } }
    },
  };
  machines.push(m);
  return m;
}

async function waitRoomCode(m, ms) {
  const t0 = now();
  while (now() - t0 < (ms || 40000)) {
    const mm = /room code ([A-Z2-9]{6})/.exec(await m.out());
    if (mm) { return mm[1]; }
    if ((await m.state()) === 'error') { break; }
    await sleep(150);
  }
  throw new Error(m.name + ' never printed a room code');
}

// Stops everything a scenario started and checks that nothing of it is left (a native game, a relay).
async function cleanup(relay) {
  for (const m of machines.splice(0)) { await m.stop(); }
  if (relay) { await relay.stop(); }
  await closeEnv();
  const orphans = [];
  if (tmpRoot) {
    for (const d of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) { continue; }
      let cwd = '';
      try { cwd = fs.readlinkSync('/proc/' + d + '/cwd'); } catch (e) { continue; }
      if (cwd.startsWith(tmpRoot)) {
        let cmd = ''; try { cmd = fs.readFileSync('/proc/' + d + '/cmdline', 'utf8').replace(/\0/g, ' ').slice(0, 80); } catch (e) { /* gone */ }
        orphans.push(d + ' ' + cmd);
        try { process.kill(+d, 'SIGKILL'); } catch (e) { /* gone */ }
      }
    }
    if (!process.env.JFDUKE3D_TEST_KEEP) { fs.rmSync(tmpRoot, { recursive: true, force: true }); } else { console.log('kept: ' + tmpRoot); }
    tmpRoot = null;
  }
  check(orphans.length === 0, 'no process this test started is left running', orphans.join('; '));
}

// ---- what a finished game must show ---------------------------------------------------------------

// All machines: exit 0, the TEST line, no desync, no version mismatch; then the dumps: at least `tics` records
// each, and identical record for record. Returns the dumps.
async function checkGame(ms, tics, opts) {
  opts = opts || {};
  const dumps = [];
  for (const m of ms) {
    const out = await m.out();
    const code = await m.exitCode();
    check(code === 0, m.name + ' ended with status 0', 'status ' + code + ': ' + (await m.status()) + ' ' + out.split('\n').slice(-4).join(' | '));
    const line = /TEST: quitting after (\d+) game tics: (\d+) sync checks, (\d+) mismatches/.exec(out);
    check(!!line && +line[1] >= (opts.lastLevelTics || tics), m.name + ' played ' + (line ? line[1] : '?') + ' game tics' + (opts.lastLevelTics ? ' of the last level' : '') + ' (need ' + (opts.lastLevelTics || tics) + ')');
    if (!opts.desyncExpected) {
      check(!/OUT OF SYNC/.test(out), m.name + ' logged no desync');
      // every machine compares a sync byte every tic (-testsync), a hidden tab included: the count must follow the tics
      if (line) { check(+line[2] >= 0.9 * +line[1] - 16, m.name + ' compared ' + line[2] + ' sync bytes in ' + line[1] + ' tics (at least 90%: a hidden tab checks too)'); }
    }
    check(!/different versions/.test(out), m.name + ' saw no version mismatch');
    check(m.errors.length === 0, m.name + ' had no page errors', m.errors.join('; '));
    dumps.push(await m.readDump());
  }
  // NETPLAY_FLIP=1: a negative control for the comparison itself: one byte of the second machine's record 600 is flipped
  if (process.env.NETPLAY_FLIP && dumps[1] && dumps[1].length > 601 * REC) { dumps[1] = Buffer.from(dumps[1]); dumps[1][600 * REC + 10] ^= 1; }
  if (!opts.desyncExpected) { await compareDumps(ms, dumps, tics); }
  return dumps;
}

// <dump>.state (testhooks.c TestStateTic): a header "t<T> randomseed=<n> level=<L>", then one line per object
// "<part> <index> field=value ...". Returns Map "t<T> L<level>" -> Map "part index" -> Map field -> value.
function parseState(text) {
  const blocks = new Map();
  let cur = null;
  for (const line of text.split('\n')) {
    const w = line.split(' ');
    if (w.length < 2) { continue; }
    if (/^t\d+$/.test(w[0])) {
      const lv = /level=(\d+)/.exec(line);
      cur = new Map();
      blocks.set(w[0] + ' L' + (lv ? lv[1] : '?'), cur);
      cur.set('header', new Map([['randomseed', (/randomseed=(-?\d+)/.exec(line) || [])[1]]]));
      continue;
    }
    if (!cur) { continue; }
    const key = w[0] + ' ' + w[1], f = new Map();
    for (const t of w.slice(2)) { const i = t.indexOf('='); if (i > 0) { f.set(t.slice(0, i), t.slice(i + 1)); } else if (t) { f.set(t, ''); } }
    cur.set(key, f);
  }
  return blocks;
}
// The fields two machines' state dumps disagree about in the block `when` ("t1 L1"). Everything the dump lists is in the hash.
function stateDifferences(a, b, when) {
  const out = [];
  const ba = a.get(when), bb = b.get(when);
  if (!ba || !bb) { return ['no state block ' + when + ' on ' + (ba ? 'the second' : 'the first')]; }
  for (const k of new Set([...ba.keys(), ...bb.keys()])) {
    const fa = ba.get(k), fb = bb.get(k);
    if (!fa || !fb) { out.push(k + ' only on ' + (fa ? 'the first' : 'the second')); continue; }
    for (const f of new Set([...fa.keys(), ...fb.keys()])) {
      if (fa.get(f) !== fb.get(f)) { out.push(k + ' ' + f + ': ' + fa.get(f) + ' against ' + fb.get(f)); }
    }
  }
  return out;
}

const WORDS = ['tic', 'seed', 'players', 'sprites', 'hittype', 'sectors', 'walls', 'other'];
// First index (record) where the dumps differ, or null; describes what differs.
function firstDifference(dumps) {
  const n = Math.min(...dumps.map((d) => Math.floor(d.length / REC)));
  for (let i = 0; i < n; i++) {
    for (let k = 1; k < dumps.length; k++) {
      const a = dumps[0].subarray(i * REC, (i + 1) * REC), b = dumps[k].subarray(i * REC, (i + 1) * REC);
      if (!a.equals(b)) {
        const diff = [];
        for (let j = 0; j < 8; j++) { if (a.readUInt32LE(j * 4) !== b.readUInt32LE(j * 4)) { diff.push(WORDS[j]); } }
        let count = 0;
        const n2 = Math.min(dumps[0].length, dumps[k].length) / REC;
        for (let q = i; q < n2; q++) { if (!dumps[0].subarray(q * REC, (q + 1) * REC).equals(dumps[k].subarray(q * REC, (q + 1) * REC))) { count++; } }
        return { index: i, tic: a.readUInt32LE(0), against: k, parts: diff, what: diff.join(',') + ' (' + count + ' of the ' + (n2 - i) + ' records from there on differ)' };
      }
    }
  }
  return null;
}

async function compareDumps(ms, dumps, tics) {
  const ok = dumps.every((d) => d && d.length % REC === 0 && d.length / REC >= tics);
  check(ok, 'every machine wrote at least ' + tics + ' tics to its dump (' + dumps.map((d) => d ? d.length / REC : 'none').join(', ') + ')');
  if (!ok) { return; }
  const diff = firstDifference(dumps);
  let fields = '';
  if (diff) {
    const sa = await ms[0].readFile('d.bin.state'), sb = await ms[diff.against].readFile('d.bin.state');
    if (sa && sb) {
      const a = parseState(sa.toString()), b = parseState(sb.toString());
      const when = [...a.keys()].find((k) => k.startsWith('t' + diff.tic + ' '));
      if (when) {
        const d = stateDifferences(a, b, when);
        fields = '; the state dumps at ' + when + ' differ in ' + d.length + ' fields: ' + d.slice(0, 20).join('; ') + (d.length > 20 ? '; ...' : '');
      } else { fields = '; no state dump at tic ' + diff.tic + ' (NETPLAY_STATE=' + diff.tic + ' makes one)'; }
    }
  }
  check(!diff, 'all ' + ms.length + ' machines agree on every tic (' + dumps.map((d) => d.length / REC).join(', ') + ' tics each; byte for byte)',
    diff ? 'first difference at tic ' + diff.tic + ' (record ' + diff.index + '): ' + ms[0].name + ' against ' + ms[diff.against].name + ' differ in ' + diff.what + fields : '');
  if (diff && !process.env.NETPLAY_QUIET) {
    for (const m of ms) { console.log('    ' + m.name + ' log: ' + (await m.out()).split('\n').filter((l) => /TEST:|OUT OF SYNC|Lobby|left|ready/i.test(l)).slice(0, 14).join(' | ')); }
  }
}

// ---- imitating a hidden tab (Bit Riot brief 12, "What the tests did instead of really hiding a tab") ----
// Playwright cannot hide a tab. The page is made to say it is hidden (document.hidden, visibilityState, a
// visibilitychange event) and, as Chromium does to a background tab, gets no animation frames and has its
// timers held to one run a second; WebSocket, WebTransport and MessageChannel events are left alone.
async function hide(page, throttle) {
  await page.evaluate((thr) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    if (thr) {
      window.requestAnimationFrame = () => 0;
      const st = window.setTimeout.bind(window), si = window.setInterval.bind(window);
      window.setTimeout = (f, ms, ...a) => st(f, Math.max(+ms || 0, 1000), ...a);
      window.setInterval = (f, ms, ...a) => si(f, Math.max(+ms || 0, 1000), ...a);
    }
    document.dispatchEvent(new Event('visibilitychange'));
  }, !!throttle);
}

// Blocks a page's main thread for `ms` (a frozen tab, a sleeping laptop).
function freeze(page, ms) {
  return page.evaluate((n) => { const t = performance.now(); while (performance.now() - t < n) { /* frozen */ } }, ms).catch(() => {});
}

// ---- sampling the speed of a running game ----------------------------------------------------------
// Samples every machine's dump size once a second until all have written `until` tics or `limit` ms pass.
// Returns, per machine, the series [[ms since the sampling began, tics]].
async function sample(ms, until, limit, onTick) {
  const series = ms.map(() => []);
  const t0 = now();
  while (now() - t0 < limit) {
    // all machines at once, and a frozen page (its evaluate() waits for the freeze to end) keeps its last count
    const counts = await Promise.all(ms.map(async (m, i) => {
      const n = await Promise.race([m.dumpSize(), sleep(900).then(() => null)]);
      return n === null ? (series[i].length ? series[i][series[i].length - 1][1] : 0) : Math.floor(n / REC);
    }));
    let done = true;
    for (let i = 0; i < ms.length; i++) {
      series[i].push([now() - t0, counts[i]]);
      if (counts[i] < until && (await ms[i].state()) === 'running') { done = false; }
    }
    if (onTick) { await onTick(now() - t0, series); }
    if (done) { break; }
    await sleep(1000);
  }
  return series;
}
// Tics a second between the moment the machine reached tic `from` and tic `to`.
function rate(series, from, to) {
  let a = null, b = null;
  for (const [t, c] of series) { if (a === null && c >= from) { a = [t, c]; } if (c >= to) { b = [t, c]; break; } }
  if (a && !b) { b = series[series.length - 1]; }     // never got that far: the rate over what it did
  if (!a || !b || b[0] <= a[0]) { return 0; }
  return (b[1] - a[1]) / ((b[0] - a[0]) / 1000);
}

// ---- scenarios ---------------------------------------------------------------------------------------

const TICS = 1200;
const LOAD = () => 'load average ' + os.loadavg().map((x) => x.toFixed(1)).join(' ');

// Two or more machines in one room. `kinds` is a list of 'browser' | 'native' (the first hosts). Returns the machines.
// o: tics, query (page knobs, per machine index function), impair(i), nudge: {i: tic}, extra(i): more game arguments,
// state: -teststate on every machine, onStart(i, m), called right after machine i is started; machine(i), more options for
// machine i's browserMachine() or nativeMachine().
async function room(relay, kinds, o) {
  o = o || {};
  const tics = o.tics || TICS;
  const ms = [];
  let code = '';
  for (let i = 0; i < kinds.length; i++) {
    const name = 'p' + i;
    const net = (kind) => (kind === 'browser'
      ? ['-relay', relay.ws].concat(i === 0 ? ['-host-room', String(kinds.length)] : ['-room', code])
      : ['-relay', relay.udp].concat(i === 0 ? ['-host-room', String(kinds.length)] : ['-room', code]));
    const args = gameArgs({ net: net(kinds[i]), tics, dump: 'd.bin', nudge: o.nudge && o.nudge[i], level: o.level, state: o.state, extra: o.extra ? o.extra(i) : [] });
    const impair = o.impair ? o.impair(i) : null;
    let m;
    if (kinds[i] === 'browser') {
      const q = (o.query ? o.query(i, relay) : '') + (impair ? '&impair=' + encodeURIComponent(impair) : '');
      m = await browserMachine(name, args, Object.assign({ query: q, dump: 'd.bin' }, o.machine ? o.machine(i) : {}));
    } else {
      m = nativeMachine(name, args, Object.assign({ impair, dump: 'd.bin' }, o.machine ? o.machine(i) : {}));
    }
    ms.push(m);
    await m.start();
    if (o.onStart) { await o.onStart(i, m); }
    if (i === 0) { code = await waitRoomCode(m); console.log('  room ' + code + ' (' + kinds[0] + ' host)'); }
  }
  return ms;
}

// The transport each browser reports in its game log ("(relay-ws)" or "(relay-wt)").
async function transportOf(m) {
  const out = await m.out();
  const mm = /(relay-(?:ws|wt|udp))[;)]/.exec(out);
  return mm ? mm[1] : null;
}

async function bounded(name, kinds, o, expectTransport) {
  const relay = await startRelay();
  try {
    console.log('  ' + kinds.join(' + ') + ' (' + LOAD() + ')');
    const ms = await room(relay, kinds, o);
    const limit = (o && o.tics ? o.tics : TICS) / NOMINAL * 1000 * 3 + 90000;
    for (const m of ms) { await m.waitEnd(limit - (now() - ms[0].started)); }
    console.log('  the game took ' + ((now() - ms[0].started) / 1000).toFixed(1) + ' s from the start of the host to the end of the last machine (' + ((o && o.tics) || TICS) + ' tics)');
    await checkGame(ms, (o && o.tics) || TICS);
    if (o && o.impair) {
      for (const m of ms) { if (m.kind === 'browser') { check(/test knobs in use:.*impair/.test(await m.out()), m.name + ' reports that the impairment knob is in use'); } }
    }
    if (expectTransport) {
      for (const m of ms) { if (m.kind === 'browser') { const t = await transportOf(m); check(t === expectTransport, m.name + ' used ' + expectTransport + ' (log says ' + t + ')'); } }
    }
    return ms;
  } finally { await cleanup(relay); }
}

const SCENARIOS = {};

SCENARIOS.ws = {
  what: 'two browsers over the WebSocket: 1200 tics, every machine agrees',
  run: () => bounded('ws', ['browser', 'browser'], {}, 'relay-ws'),
};
SCENARIOS.ws3 = {
  what: 'three browsers over the WebSocket: 1200 tics, every machine agrees',
  run: () => bounded('ws3', ['browser', 'browser', 'browser'], {}, 'relay-ws'),
};
SCENARIOS['browser-host'] = {
  what: 'a browser hosts, a native game joins (UDP to the relay): 1200 tics, dumps equal',
  run: () => bounded('browser-host', ['browser', 'native'], {}, 'relay-ws'),
};
SCENARIOS['native-host'] = {
  what: 'a native game hosts, a browser joins: 1200 tics, dumps equal',
  run: () => bounded('native-host', ['native', 'browser'], {}, 'relay-ws'),
};
SCENARIOS.mixed3 = {
  what: 'three players in one room, a browser hosting and a native and a browser joining: 1200 tics, dumps equal',
  run: async () => {
    await bounded('mixed3', ['browser', 'native', 'browser'], {}, 'relay-ws');
    await bounded('mixed3-native-host', ['native', 'browser', 'browser'], {}, 'relay-ws');
  },
};

// ---- impairment ---------------------------------------------------------------------------------------

const IMPAIR = (i) => (process.env.NETPLAY_IMPAIR || 'lat=30,jit=10,loss=4,dup=2,reorder=3') + ',seed=' + (101 + i);     // (NETPLAY_IMPAIR: a harsher spec, as a control)
SCENARIOS.impaired = {
  what: 'loss, duplication, reordering and latency on every machine (a seed each): browser host and native slave over WebSocket, then three browsers',
  run: async () => {
    await bounded('impaired', ['browser', 'native'], { impair: IMPAIR }, 'relay-ws');
    await bounded('impaired3', ['browser', 'browser', 'browser'], { impair: IMPAIR }, 'relay-ws');
  },
};

// Two browsers over WebTransport (a -dev-cert relay: the certificate hash and the URL are test knobs), and a native host with
// two browsers. Chromium here may not do WebTransport to a local development certificate: the scenario says so if it does not.
const WT = (i, relay) => '&relay_wt=' + encodeURIComponent(relay.wt) + '&relay_cert=' + relay.cert;
SCENARIOS.wt = {
  what: 'two browsers over WebTransport (a -dev-cert relay, the certificate hash as a test knob), and a native player in the room',
  run: async () => {
    await bounded('wt', ['browser', 'browser'], { query: WT }, 'relay-wt');
    await bounded('wt-native', ['native', 'browser', 'browser'], { query: WT }, 'relay-wt');
  },
};

// ---- a level exit (A1's -testexit) with browsers ----------------------------------------------------------
// Every machine leaves E1L1 at tic 200 (the game's own writer of MODE_EOL, run inside the tic: player.c) and plays 300 tics of E1L2,
// the players firing the chaingun and walking about (-testfire: the ammunition carried over changes every few tics, and a missing
// or extra tic would move a player somewhere else). The dumps (500 records, the 201st is tic 1 of the next level) and the state at
// the next level's start, its tic 1, 2 and 300 must agree. With a hidden tab (hiddenIdx) the tab draws nothing of either level.
const EXIT_TIC = 200, EXIT_TICS = 300;
async function levelExitGame(kinds, hiddenIdx, o) {
  o = o || {};
  const relay = await startRelay();
  try {
    console.log('  ' + kinds.join(' + ') + (hiddenIdx !== undefined ? ', ' + kinds[hiddenIdx] + ' ' + hiddenIdx + ' hidden from the start' : '') + ' (' + LOAD() + ')');
    // o.stall: { machine index: 'T,ms' } (-teststall: that machine stops for ms at tic T of the first level, ten tics before the exit),
    // o.impair(i): VNET_IMPAIR / the impair knob of machine i
    const ms = await room(relay, kinds, { tics: EXIT_TICS, state: [EXIT_TICS], impair: o.impair,
      extra: (i) => ['-testexit' + EXIT_TIC, '-testfire150'].concat(o.stall && o.stall[i] ? ['-teststall' + o.stall[i]] : []) });
    let framesAtHide = null, framesL2 = null;
    if (hiddenIdx !== undefined) {
      const h = ms[hiddenIdx];
      // hidden as soon as its game has started and written a few tics
      const t0 = now();
      while (now() - t0 < 60000 && (await h.dumpSize()) < 5 * REC) { await sleep(100); }
      await hide(h.page, true);
      await sleep(300);
      framesAtHide = await h.page.evaluate(() => Module.jfswShowframes);
      console.log('  ' + h.name + ' hidden at tic ' + Math.floor((await h.dumpSize()) / REC));
    }
    // a hidden tab: pictures asked for from the hide to the end of the first level, and from tic 15 of the second to its end (the level
    // change itself draws: premap.c's loading screen, fades and first frame, on every machine)
    let framesBeforeExit = null;
    if (hiddenIdx !== undefined) {
      const h = ms[hiddenIdx];
      const lim = now() + (EXIT_TIC + EXIT_TICS) / NOMINAL * 1000 * 3 + 90000;
      while (now() < lim && (await h.state()) === 'running') {
        const n = Math.floor((await h.dumpSize()) / REC);
        if (framesBeforeExit === null && n >= EXIT_TIC - 5) { framesBeforeExit = await h.page.evaluate(() => Module.jfswShowframes).catch(() => null); }
        if (framesL2 === null && n >= EXIT_TIC + 15) { framesL2 = await h.page.evaluate(() => Module.jfswShowframes).catch(() => null); }
        await sleep(100);
      }
    }
    for (const m of ms) { await m.waitEnd((EXIT_TIC + EXIT_TICS) / NOMINAL * 1000 * 3 + 90000); }
    const dumps = await checkGame(ms, EXIT_TIC + EXIT_TICS, { lastLevelTics: EXIT_TICS });
    for (const m of ms) {
      const out = await m.out();
      check(new RegExp('TEST: ending the level at tic ' + EXIT_TIC + ' ').test(out), m.name + ' ended the first level at tic ' + EXIT_TIC);
      const left = /TEST: left the level after tic (\d+)/.exec(out);
      check(!!left && +left[1] === EXIT_TIC, m.name + ' played exactly ' + EXIT_TIC + ' tics of the first level (' + (left ? left[1] : '?') + ')');
    }
    for (const i of Object.keys(o.stall || {})) { check(/TEST: stalling for 1500 ms at tic 190/.test(await ms[+i].out()), ms[+i].name + ' stopped for 1.5 s at tic 190'); }
    if (dumps.every((d) => d && d.length >= (EXIT_TIC + 1) * REC)) {
      check(dumps.every((d) => d.readUInt32LE(EXIT_TIC * REC) === 1), 'record ' + (EXIT_TIC + 1) + ' of every dump is tic 1 of the next level');
    }
    // the state dumps: at the next level's start (its tic 1 and 2) and at its last tic
    const states = [];
    for (const m of ms) { const b = await m.readFile('d.bin.state'); states.push(b ? parseState(b.toString()) : null); }
    check(states.every(Boolean), 'every machine wrote its state dump');
    if (states.every(Boolean)) {
      for (const when of ['t1 L2', 't2 L2', 't' + EXIT_TICS + ' L2']) {
        for (let k = 1; k < ms.length; k++) {
          const d = stateDifferences(states[0], states[k], when);
          check(d.length === 0, 'the state of ' + ms[k].name + ' agrees with ' + ms[0].name + ' field for field at ' + when, d.slice(0, 6).join('; '));
        }
      }
    }
    if (hiddenIdx !== undefined) {
      const h = ms[hiddenIdx];
      const f = await h.page.evaluate(() => ({ frames: Module.jfswShowframes, passes: Module.jfswHiddenLog.length })).catch(() => null);
      if (f) {
        console.log('  hidden tab: ' + f.passes + ' hidden passes; pictures asked for: ' + (framesBeforeExit - framesAtHide) + ' from the hide to tic ' + (EXIT_TIC - 5) + ', ' + (f.frames - framesL2) + ' from tic 15 of the second level to its end, ' + (framesL2 - framesBeforeExit) + ' in between (the level change: loading screen, fades, first frame)');
        check(framesBeforeExit !== null && framesBeforeExit - framesAtHide < 5, h.name + ' drew nothing in the first level while hidden (' + (framesBeforeExit - framesAtHide) + ' pictures asked for)');
        check(framesL2 !== null && f.frames - framesL2 < 5, h.name + ' drew nothing in the second level while hidden (' + (f.frames - framesL2) + ' pictures asked for)');
        check(f.passes > 100, h.name + ' was driven by hidden-tab passes (' + f.passes + ')');
      }
    }
    return ms;
  } finally { await cleanup(relay); }
}
const EXIT_SLAVE = () => levelExitGame(['browser', 'native', 'browser'], undefined, { stall: { 2: '190,1500' } });
const EXIT_MASTER = () => levelExitGame(['browser', 'native', 'browser'], undefined, { stall: { 0: '190,1500' }, impair: (i) => (i > 0 ? 'lat=200,seed=' + (31 + i) : null) });
SCENARIOS['level-exit-slave'] = { manual: true, what: 'the first game of level-exit alone (a browser slave stopped at tic 190)', run: EXIT_SLAVE };
SCENARIOS['level-exit-master'] = { manual: true, what: 'the second game of level-exit alone (the browser master stopped, late datagrams)', run: EXIT_MASTER };
SCENARIOS['level-exit'] = {
  what: 'a level exit with browsers (A1\'s -testexit): a browser host, a native and a browser joiner leave E1L1 at tic 200 and play 300 tics of E1L2, a browser slave stopped for 1.5 s at tic 190 (D6), then the browser master stopped with late datagrams (D5); dumps and states agree',
  run: async () => { await EXIT_SLAVE(); await EXIT_MASTER(); },
};
SCENARIOS['hidden-level'] = {
  what: 'a level exit with a browser slave hidden from the start: it draws nothing of either level, every machine agrees through the level change',
  run: async () => {
    await levelExitGame(['browser', 'browser'], 1);
    await levelExitGame(['native', 'browser'], 1);
  },
};

// ---- a hidden tab (brief 04) ------------------------------------------------------------------------------
// A hidden, throttled tab as slave or as host: the room must keep at least 90 % of the nominal tic rate, measured on
// the OTHER machine (the one that is visible), over at least 30 s; and everyone still agrees.
const HIDDEN_TICS = 1500, FROM = 250, TO = 1450;
async function hiddenRoom(kinds, hiddenIndex, opts) {
  opts = opts || {};
  const want = (opts.nominal || NOMINAL);
  const relay = await startRelay();
  try {
    console.log('  ' + kinds.join(' + ') + ', ' + (hiddenIndex === 0 ? 'the host' : 'the slave') + ' hidden (' + LOAD() + ')');
    const ms = await room(relay, kinds, { tics: opts.tics || HIDDEN_TICS, query: opts.wakeEvery ? (i) => (i === hiddenIndex ? '&wake_every=' + opts.wakeEvery : '') : null });
    const h = ms[hiddenIndex];
    let hideTic = -1, tHide = 0, hidden = false, framesAtHide = 0, hiddenLogAtHide = 0, froze = false, fp = null;
    let owedAtHide = 0, owedAtTo = -1, logAtTo = 0;
    const series = await sample(ms, opts.tics || HIDDEN_TICS, HIDDEN_TICS / NOMINAL * 1000 * 2.5 + 40000, async (t, ser) => {
      const tics = ser[hiddenIndex][ser[hiddenIndex].length - 1][1];
      if (!hidden && tics >= 100 && h.kind === 'browser') {
        hidden = true;
        await hide(h.page, true);
        await sleep(300);
        framesAtHide = await h.page.evaluate(() => Module.jfswShowframes);
        hiddenLogAtHide = await h.page.evaluate(() => Module.jfswHiddenLog.length);
        owedAtHide = await h.page.evaluate(() => Module.jfswOwedLog.length);
        hideTic = Math.floor((await h.dumpSize()) / REC);
        tHide = now();
        console.log('  ' + h.name + ' hidden at tic ' + hideTic);
      }
      if (hidden && owedAtTo < 0 && tics >= TO) {
        owedAtTo = await h.page.evaluate(() => Module.jfswOwedLog.length).catch(() => -1);
        logAtTo = await h.page.evaluate(() => Module.jfswHiddenLog.length).catch(() => 0);
      }
      if (opts.freeze && hidden && !froze && tics >= 300) {
        froze = true;
        console.log('  freezing the hidden ' + h.name + ' for ' + opts.freeze + ' ms at tic ' + tics);
        fp = freeze(h.page, opts.freeze);      // not awaited: the others are watched meanwhile
      }
    });
    if (fp) { await fp; }
    const tEnd = now();
    const logEnd = await h.page.evaluate(() => Module.jfswHiddenLog.length).catch(() => 0);
    for (const m of ms) { await m.waitEnd(30000); }
    const wakes = await h.page.evaluate(() => ({ wakes: Module.jfswWakes, log: Module.jfswHiddenLog.length, frames: Module.jfswShowframes, reasons: Module.jfswHiddenLog.reduce((a, r) => { a[r] = (a[r] || 0) + 1; return a; }, {}), owed: Module.jfswOwedLog.slice() })).catch(() => null);
    await checkGame(ms, opts.tics || HIDDEN_TICS);
    // The rate window starts a margin after the tab was hidden (and after the stall and the catching up, if there was one).
    const fromT = Math.max(opts.freeze ? 700 : FROM, hideTic + 100);
    check(hideTic >= 0 && hideTic + 100 <= fromT, h.name + ' was hidden at tic ' + hideTic + ', before the rate window (tic ' + fromT + ' to ' + TO + ') began');
    const rates = ms.map((m, i) => rate(series[i], fromT, TO));
    console.log('  tic rates between tic ' + fromT + ' and ' + TO + ': ' + ms.map((m, i) => m.name + (i === hiddenIndex ? '(hidden)' : '') + ' ' + rates[i].toFixed(1)).join(', ') + ' (nominal ' + want + '); ' + LOAD());
    for (let i = 0; i < ms.length; i++) {
      if (i === hiddenIndex) { continue; }
      check(rates[i] >= 0.9 * want, ms[i].name + ' (visible) ran at ' + rates[i].toFixed(1) + ' tics a second, at least 90% of ' + want, 'got ' + rates[i].toFixed(1));
    }
    check(rates[hiddenIndex] >= 0.9 * want, h.name + ' (hidden) ran at ' + rates[hiddenIndex].toFixed(1) + ' tics a second too', 'got ' + rates[hiddenIndex].toFixed(1));
    if (opts.freeze) {
      // The visible machines go on producing inputs (up to 100 ahead) while the hidden tab is stuck; when it runs again the
      // game's own lag correction (a slave moves its clock on by the lag it measures) lets it hand them in faster than
      // nominal, so the room is late by less than the whole stall.
      const v = series[ms.findIndex((m, i) => i !== hiddenIndex)];
      const t0 = (v.find((x) => x[1] >= 300) || [0])[0], t1 = (v.find((x) => x[1] >= 1400) || [0])[0];
      const late = (t1 - t0) / 1000 - (1400 - 300) / NOMINAL;
      console.log('  the visible machine took ' + ((t1 - t0) / 1000).toFixed(1) + ' s for tics 300 to 1400 (' + ((1400 - 300) / NOMINAL).toFixed(1) + ' s at the nominal rate): late by ' + late.toFixed(1) + ' s, after a ' + opts.freeze / 1000 + ' s stall');
      check(late < opts.freeze / 1000 - 1, 'the room made up most of the stall (late by ' + late.toFixed(1) + ' s, not the whole ' + opts.freeze / 1000 + ' s)', late.toFixed(1));
      check(late > 0.2, 'and the stall really delayed it (late by ' + late.toFixed(1) + ' s)');
    }
    if (wakes) {
      console.log('  hidden tab: ' + wakes.wakes + ' wake-ups, ' + wakes.log + ' hidden yields (resumed by: ' + JSON.stringify(wakes.reasons) + ': 1 network event, 0 timer), ' + wakes.frames + ' pictures asked for in all (' + framesAtHide + ' when it was hidden)');
      // a thinned tab (hidden-thin) gets only every Nth wake-up: it needs a lower bar of its own
      const minPasses = opts.wakeEvery ? 150 : 200;
      check(wakes.log - hiddenLogAtHide > minPasses, h.name + ' was driven by hidden-tab passes (' + (wakes.log - hiddenLogAtHide) + ' after it was hidden, more than ' + minPasses + ')');
      check((wakes.reasons[1] || 0) > 0.8 * wakes.log, h.name + ' was resumed by network events, not the timer (' + (wakes.reasons[1] || 0) + ' of ' + wakes.log + ')');
      // an input that is made but held back by mmulti's 25 ms send window must not wait for the next network event: the pass
      // flushes it. So (almost) no yield is entered with data still owed.
      const passesPerSec = (logEnd - hiddenLogAtHide) / ((tEnd - tHide) / 1000);
      console.log('  hidden passes (yields) a second while hidden: ' + passesPerSec.toFixed(0) + '; entered with data still held back: ' + wakes.owed.length + ' of ' + wakes.log + (wakes.owed.length ? ' (they lasted ' + wakes.owed.slice(0, 12).map((x) => Math.round(x)).join(', ') + ' ms' + (wakes.owed.length > 12 ? ', ...' : '') + ')' : ''));
      // (counted from just after the hide to tic TO: the hide itself and -testquit's linger loop at the end are not what is measured)
      const owedMid = owedAtTo >= 0 ? owedAtTo - owedAtHide : wakes.owed.length, logMid = owedAtTo >= 0 ? logAtTo - hiddenLogAtHide : wakes.log;
      console.log('  between the hide and tic ' + TO + ': ' + owedMid + ' of ' + logMid + ' hidden yields entered with data held back');
      check(owedMid <= 0.01 * logMid + 5, h.name + ' entered ' + owedMid + ' of ' + logMid + ' yields with data still held back between the hide and tic ' + TO + ' (at most 1% and 5)');
      // CPU: the tab must not spin. Every pass is a network event or the timer.
      check(passesPerSec < 150, h.name + ' ran ' + passesPerSec.toFixed(0) + ' hidden passes a second (under 150: it waits for network events)');
      check(wakes.frames - framesAtHide < 20, h.name + ' drew nothing while hidden (' + (wakes.frames - framesAtHide) + ' pictures asked for after hiding, in about 45 s)');
    }
  } finally { await cleanup(relay); }
}
SCENARIOS['hidden-slave'] = {
  what: 'a hidden, throttled browser slave: the room keeps at least 90% of 30 tics a second, all agree',
  run: () => hiddenRoom(['browser', 'browser'], 1),
};
SCENARIOS['hidden-frozen'] = {
  what: 'a hidden slave whose main thread is stuck for 3 s mid-game: the room waits, catches up most of the stall, and every machine agrees',
  run: () => hiddenRoom(['browser', 'browser'], 1, { freeze: 3000 }),
};
// The same with the hidden tab's network wake-ups thinned to every 6th (as if the peer were quiet, or the events bunched).
SCENARIOS['hidden-thin'] = {
  what: 'a hidden slave that gets only every 6th network wake-up: still 90% of 30 tics a second',
  run: () => hiddenRoom(['browser', 'browser'], 1, { wakeEvery: +process.env.NETPLAY_WAKE_EVERY || 6 }),
};
SCENARIOS['hidden-host'] = {
  what: 'a hidden, throttled browser host with a native slave: the same',
  run: () => hiddenRoom(['browser', 'native'], 0),
};
SCENARIOS['hidden-local'] = {
  what: 'a single player game in a hidden tab still pauses (no hidden-tab passes, the picture is still drawn)',
  run: async () => {
    try {
      const m = await browserMachine('single', ['-v1', '-l1', '-s1', '-testdumpd.bin'], { dump: 'd.bin' });
      await m.start();
      // let it run visible for a while: a control, so that the hidden numbers mean something
      await sleep(14000);
      const t0 = await m.dumpSize() / REC, f0 = await m.page.evaluate(() => Module.jfswFrameLog.length);
      await sleep(5000);
      const t1 = await m.dumpSize() / REC, f1 = await m.page.evaluate(() => Module.jfswFrameLog.length);
      const visibleRate = (t1 - t0) / 5;
      check(visibleRate > 0.8 * NOMINAL, 'control: the visible single player game runs at ' + visibleRate.toFixed(1) + ' tics a second', 'got ' + visibleRate.toFixed(1));
      check(f1 - f0 > 100, 'control: and draws pictures (' + (f1 - f0) + ' frame yields in 5 s)');
      await hide(m.page, true);
      await sleep(2000);
      const h0 = await m.dumpSize() / REC, hf0 = await m.page.evaluate(() => Module.jfswFrameLog.length), hl0 = await m.page.evaluate(() => Module.jfswHiddenLog.length);
      await sleep(12000);
      const h1 = await m.dumpSize() / REC, hf1 = await m.page.evaluate(() => Module.jfswFrameLog.length), hl1 = await m.page.evaluate(() => Module.jfswHiddenLog.length);
      const hiddenRate = (h1 - h0) / 12;
      console.log('  hidden single player: ' + hiddenRate.toFixed(1) + ' tics a second, ' + (hf1 - hf0) + ' frame yields, ' + (hl1 - hl0) + ' hidden-tab passes in 12 s');
      check(hl1 === hl0, 'no hidden-tab passes in a single player game (' + (hl1 - hl0) + ')');
      check(hf1 - hf0 >= 5, 'the game still draws and yields once a frame (' + (hf1 - hf0) + ' frame yields in 12 s)');
      check(hiddenRate < 0.5 * visibleRate, 'it runs far below normal speed (' + hiddenRate.toFixed(1) + ' against ' + visibleRate.toFixed(1) + ' tics a second): a pause, not a free run');
    } finally { await cleanup(null); }
  },
};

// ---- what drawing writes (the drawing-state audit, code-facts.md section 20) -------------------------------------
// A browser tab hidden from the start (it draws nothing: the game asks for no picture) plays with machines that draw, in a game that
// goes where drawing writes to the simulation's tables. The dumps and the states must agree. 'camera': every player stands in front
// of a security monitor and presses use (-testcam60,0): a machine that draws counts frames in the monitor's hittype temp_data[0];
// 'mirror': in front of a mirror, firing the RPG from tic 120 (-testmirror60,0): drawn (a second drawrooms()), then broken.
async function drawStateGame(label, kinds, hiddenIdx, hook, tics) {
  const relay = await startRelay();
  try {
    console.log('  ' + label + ': ' + kinds.join(' + ') + ', ' + kinds[hiddenIdx] + ' ' + hiddenIdx + ' hidden from the start (' + LOAD() + ')');
    const ms = await room(relay, kinds, { tics, state: [tics], extra: () => [hook] });
    const h = ms[hiddenIdx];
    const t0 = now();
    while (now() - t0 < 60000 && (await h.dumpSize()) < 3 * REC) { await sleep(50); }
    await hide(h.page, true);
    await sleep(300);
    const framesAtHide = await h.page.evaluate(() => Module.jfswShowframes);
    console.log('  ' + h.name + ' hidden at tic ' + Math.floor((await h.dumpSize()) / REC));
    for (const m of ms) { await m.waitEnd(tics / NOMINAL * 1000 * 3 + 90000); }
    await checkGame(ms, tics);
    for (const m of ms) {
      const out = await m.out();
      if (/-testcam/.test(hook)) { check(/TEST: go: monitor sprite \d+: yvel 1 .*camsprite \d/.test(out), m.name + ': the monitor switched to its camera (' + ((/TEST: go: monitor sprite[^\n]*/.exec(out) || ['none'])[0]) + ')'); }
      else { check(/TEST: go: mirror wall \d+: overpicnum 70 /.test(out), m.name + ': the mirror was broken (' + ((/TEST: go: mirror wall[^\n]*/.exec(out) || ['none'])[0]) + ')'); }
    }
    const states = [];
    for (const m of ms) { const b = await m.readFile('d.bin.state'); states.push(b ? parseState(b.toString()) : null); }
    if (states.every(Boolean)) {
      for (const when of ['t1 L1', 't2 L1', 't' + tics + ' L1']) {
        for (let k = 1; k < ms.length; k++) {
          const d = stateDifferences(states[0], states[k], when);
          check(d.length === 0, 'the state of ' + ms[k].name + ' agrees with ' + ms[0].name + ' field for field at ' + when, d.slice(0, 6).join('; '));
        }
      }
    }
    const f = await h.page.evaluate(() => ({ frames: Module.jfswShowframes, passes: Module.jfswHiddenLog.length })).catch(() => null);
    const vis = ms.findIndex((m, i) => i !== hiddenIdx && m.kind === 'browser');
    const vf = vis >= 0 ? await ms[vis].page.evaluate(() => Module.jfswShowframes).catch(() => 0) : 0;
    if (f) {
      console.log('  pictures asked for: ' + (f.frames - framesAtHide) + ' by the hidden tab after it was hidden, ' + vf + ' by the visible browser; ' + f.passes + ' hidden passes');
      check(f.frames - framesAtHide < 20, h.name + ' drew nothing while hidden (' + (f.frames - framesAtHide) + ' pictures asked for)');
      if (vis >= 0) { check(vf > tics, ms[vis].name + ' (visible) drew its pictures (' + vf + ')'); }
    }
    return ms;
  } finally { await cleanup(relay); }
}
SCENARIOS['draw-state'] = {
  what: 'a hidden tab (no drawing) and machines that draw stay in sync over security cameras (animatecamsprite) and a mirror (drawn, then broken by rockets)',
  run: async () => {
    await drawStateGame('camera', ['browser', 'browser', 'native'], 1, '-testcam60,0', 400);
    await drawStateGame('mirror', ['browser', 'native', 'browser'], 2, '-testmirror60,0', 600);
  },
};

// ---- frozen tabs and a lost relay session --------------------------------------------------------------------

// A tab whose main thread is blocked for 5 s in the middle of a game: the room waits, goes on, all agree.
const FREEZE_MS = +process.env.NETPLAY_FREEZE_MS || 5000;      // (a longer freeze is the negative control: the relay drops a silent member after 15 s)
async function frozenRoom(kinds, frozenIndex) {
  const relay = await startRelay();
  try {
    console.log('  ' + kinds.join(' + ') + ', ' + (frozenIndex === 0 ? 'the host' : 'the slave') + ' frozen for ' + FREEZE_MS / 1000 + ' s (' + LOAD() + ')');
    const ms = await room(relay, kinds, { tics: TICS });
    const f = ms[frozenIndex];
    let froze = false, before = [], fp = null, t0 = 0, t1 = 0, tf = 0;
    const series = await sample(ms, TICS, TICS / NOMINAL * 1000 * 2.5 + FREEZE_MS + 40000, async (t, ser) => {
      const tics = ser[frozenIndex][ser[frozenIndex].length - 1][1];
      if (!froze && tics >= 300) {
        froze = true;
        before = ms.map((m, i) => ser[i][ser[i].length - 1][1]);
        console.log('  freezing ' + f.name + ' at tic ' + tics);
        t0 = now(); tf = t;
        fp = freeze(f.page, FREEZE_MS).then(() => { t1 = now(); });     // not awaited: the other machines are watched meanwhile
      }
    });
    if (fp) { await fp; }
    for (const m of ms) { await m.waitEnd(30000); }
    await checkGame(ms, TICS);
    check(froze, 'the tab was frozen in the middle of the game (at tic ' + before[frozenIndex] + ')');
    console.log('  ' + f.name + ' was frozen for ' + ((t1 - t0) / 1000).toFixed(1) + ' s');
    // the others could not move on without the frozen player's input: they stood still, and then played on
    const other = ms.findIndex((m, i) => i !== frozenIndex);
    const at = (ser, ms_) => { let c = 0; for (const [tt, n] of ser) { if (tt <= ms_) { c = n; } } return c; };
    const adv = at(series[other], tf + (t1 - t0)) - at(series[other], tf);
    console.log('  ' + ms[other].name + ' moved ' + adv + ' tics in the ' + ((t1 - t0) / 1000).toFixed(1) + ' s the other tab was frozen (nominal ' + (NOMINAL * FREEZE_MS / 1000) + ')');
    check(adv < 0.5 * NOMINAL * FREEZE_MS / 1000, ms[other].name + ' (not frozen) could not move on without the frozen player: ' + adv + ' tics in ' + FREEZE_MS / 1000 + ' s, not ' + NOMINAL * FREEZE_MS / 1000);
    check(series[other][series[other].length - 1][1] >= TICS, ms[other].name + ' then played on to tic ' + series[other][series[other].length - 1][1]);
  } finally { await cleanup(relay); }
}
SCENARIOS['frozen-slave'] = {
  what: 'a browser slave frozen for 5 s mid-game: the room waits and goes on, all agree, the game does not end early',
  run: () => frozenRoom(['browser', 'browser'], 1),
};
SCENARIOS['frozen-host'] = {
  what: 'a browser host frozen for 5 s mid-game (native slave): the same',
  run: () => frozenRoom(['browser', 'native'], 0),
};

// The relay drops a member that was silent for longer than its session timeout (here 3 s; a frozen tab sends no
// keepalives). The game of that machine must end with the overlay message and status 1 instead of standing still (NetLostCheck).
SCENARIOS['relay-lost'] = {
  what: 'the relay drops a frozen tab (session timeout 3 s): that machine ends with status 1 and the relay message on the overlay',
  run: async () => {
    const relay = await startRelay(['-session-timeout', '3s', '-keepalive', '1s']);
    try {
      const ms = await room(relay, ['browser', 'browser'], { tics: TICS });
      const f = ms[1];
      await sample(ms, 300, 90000, async () => {});
      console.log('  freezing ' + f.name + ' for 6 s at tic ' + Math.floor((await f.dumpSize()) / REC));
      await freeze(f.page, 6000);
      const t0 = now();
      const st = await f.waitEnd(30000);
      const took = (now() - t0) / 1000, text = await f.status(), code = await f.exitCode();
      console.log('  ' + f.name + ' ended ' + took.toFixed(1) + ' s after it thawed: ' + text);
      check(st === 'error' && code === 1, f.name + ' ended with status 1 (' + st + ', ' + code + ')');
      check(/Network game failed.*relay ended the session/i.test(text), f.name + ': the overlay says why', text);
      check(took < 15, f.name + ' ended within 15 s of thawing (' + took.toFixed(1) + ')');
      check(f.errors.length === 0, f.name + ' had no page errors', f.errors.join('; '));
    } finally { await cleanup(relay); }
  },
};

// Desync detection works: -testnudge on one machine makes the sync check log GAME OUT OF SYNC, and the dumps differ from
// that tic on (the nudge moves that player 8 units at tic NUDGE; its record of tic NUDGE+1 is the first to differ). Every
// machine compares (code-facts section 2.5): the master each slave's byte against its own, a slave its own against the master's.
const NUDGE = 300;
async function nudgeRoom(nudgedIndex) {
  const relay = await startRelay();
  try {
    console.log('  browser + browser, the ' + (nudgedIndex === 0 ? 'master' : 'slave') + ' nudged at tic ' + NUDGE + ' (' + LOAD() + ')');
    const tics = 700;
    const ms = await room(relay, ['browser', 'browser'], { tics, nudge: { [nudgedIndex]: String(NUDGE) } });
    for (const m of ms) { await m.waitEnd(120000); }
    const dumps = await checkGame(ms, tics, { desyncExpected: true });
    for (const m of ms) {
      const out = await m.out();
      const logged = (out.match(/GAME OUT OF SYNC/g) || []).length;
      check(logged > 0, m.name + ' logged GAME OUT OF SYNC (' + logged + ' lines): ' + (out.match(/GAME OUT OF SYNC[^\n]*/) || ['(none)'])[0]);
    }
    const d = firstDifference(dumps);
    check(!!d && d.tic >= NUDGE + 1 && d.tic <= NUDGE + 3, 'the dumps first differ at tic ' + (d ? d.tic : 'never') + ' (the nudge was at ' + NUDGE + ')', d ? d.what : '');
    if (d) {
      const n = Math.min(dumps[0].length, dumps[1].length) / REC;
      let differ = 0;
      for (let i = d.index; i < n; i++) { if (!dumps[0].subarray(i * REC + 8, (i + 1) * REC).equals(dumps[1].subarray(i * REC + 8, (i + 1) * REC))) { differ++; } }
      check(differ >= 0.95 * (n - d.index), 'and they stay different from there on (' + differ + ' of ' + (n - d.index) + ' records differ in a state hash)');
    }
  } finally { await cleanup(relay); }
}
SCENARIOS['nudge-slave'] = {
  what: 'desync detection: -testnudge on the slave: both machines log GAME OUT OF SYNC and the dumps differ from that tic on',
  run: () => nudgeRoom(1),
};
SCENARIOS['nudge-master'] = {
  what: 'desync detection: -testnudge on the master',
  run: () => nudgeRoom(0),
};

// ---- failures end on the page's overlay ----------------------------------------------------------------------

// The page's overlay shows the game's message when a network game cannot start. `args` are the game's arguments.
async function failCase(label, args, re, opts) {
  opts = opts || {};
  const m = await browserMachine('f-' + label, args, { dump: 'd.bin' });
  const t0 = now();
  await m.start();
  const st = await m.waitEnd(opts.limit || 60000);
  const took = (now() - t0) / 1000;
  const text = await m.status();
  const code = await m.exitCode();
  const visible = await m.page.evaluate(() => !document.getElementById('overlay').hidden && !document.getElementById('reload').hidden);
  console.log('  ' + label + ': ' + took.toFixed(1) + ' s, status ' + code + ': ' + text.replace(/\s+/g, ' ').slice(0, 200));
  check(st === 'error' && code === 1, label + ': the game ended with status 1 (' + st + ', ' + code + ')');
  check(re.test(text), label + ': the page says why (' + re + ')', text);
  check(visible, label + ': on the page\'s end-of-game overlay with the reload button');
  check(m.errors.length === 0, label + ': no page errors', m.errors.join('; '));
  if (opts.under) { check(took < opts.under, label + ': within ' + opts.under + ' s (' + took.toFixed(1) + ')'); }
  await m.stop();
  machines.splice(machines.indexOf(m), 1);
  return took;
}

SCENARIOS.errors = {
  what: 'failures end on the page overlay with the game\'s message: relay unreachable, no such room, room full, host gone during the wait, plain -net, a UDP-style -relay',
  run: async () => {
    let relay = null;
    try {
      // no relay is running on PORT_NONE
      await failCase('relay-unreachable', gameArgs({ net: ['-relay', 'ws://127.0.0.1:' + PORT_NONE + '/vnet', '-host-room', '2'] }), /Network game failed.*(could not be reached|did not answer)/i, { under: 30 });
      await failCase('plain-net', gameArgs({ net: ['-nm:2'] }), /needs a relay.*plain -net needs UDP/is, { under: 10 });
      await failCase('udp-relay-address', gameArgs({ net: ['-relay', '127.0.0.1:' + PORT_UDP, '-host-room', '2'] }), /wants the relay's WebSocket URL/i, { under: 10 });
      await failCase('bad-code', gameArgs({ net: ['-relay', 'ws://127.0.0.1:' + PORT_HTTP + '/vnet', '-room', 'ABC'] }), /room code is 6 letters/i, { under: 10 });
      relay = await startRelay(['-max-members', '2']);
      await failCase('no-such-room', gameArgs({ net: ['-relay', relay.ws, '-room', 'ABCDEF'] }), /Network game failed.*no room with that code/i, { under: 20 });

      // room full: the relay takes 2 members; two players are in (idle in the menu: no level arguments), a third is refused
      const idle = (net) => gameArgs({ net, level: false, testsync: false });
      const host = await browserMachine('full-host', idle(['-relay', relay.ws, '-host-room', '2']), { dump: 'd.bin' });
      await host.start();
      const code = await waitRoomCode(host);
      const j1 = await browserMachine('full-p1', idle(['-relay', relay.ws, '-room', code]), { dump: 'd.bin' });
      await j1.start();
      const t0 = now();
      while (!/joined room/.test(await j1.out()) && now() - t0 < 20000) { await sleep(200); }
      await failCase('room-full', idle(['-relay', relay.ws, '-room', code]), /Network game failed.*room is full/i, { under: 20 });
      for (const m of [host, j1]) { await m.stop(); machines.splice(machines.indexOf(m), 1); }

      // the host goes away while the game waits for a third player: the joiner gives up 10 s after the host's last answer
      // (this relay's rooms hold 2, so -host-room 3 would be clamped to 2 and the game would start: use one with room for 4)
      await relay.stop();
      relay = await startRelay(['-max-members', '4']);
      const h3 = await browserMachine('gone-host', idle(['-relay', relay.ws, '-host-room', '3']), { dump: 'd.bin' });
      await h3.start();
      const code3 = await waitRoomCode(h3);
      const g3 = await browserMachine('gone-joiner', idle(['-relay', relay.ws, '-room', code3]), { dump: 'd.bin' });
      await g3.start();
      const t1 = now();
      while (!/joined room/.test(await g3.out()) && now() - t1 < 20000) { await sleep(200); }
      await sleep(3000);       // it has been answered by now
      const tgone = now();
      await h3.stop();         // the host's tab closes
      const st = await g3.waitEnd(40000);
      const took = (now() - tgone) / 1000, text = await g3.status(), c3 = await g3.exitCode();
      console.log('  host-gone: the joiner gave up ' + took.toFixed(1) + ' s after the host left: ' + text.replace(/\s+/g, ' ').slice(0, 200));
      check(st === 'error' && c3 === 1, 'host-gone: the joiner ended with status 1 (' + st + ', ' + c3 + ')');
      check(/Network game failed.*host stopped answering/i.test(text), 'host-gone: the page says the host stopped answering', text);
      check(took >= 8 && took <= 25, 'host-gone: after about 10 s (' + took.toFixed(1) + ')');
    } finally { await cleanup(relay); }
  },
};

// The shareware network gate (D14) in the browser: with the default config.js (allowSharewareNetGames false) a network game on the
// shareware GRP is refused with the game's message on the overlay, and no room is made. The address cannot open the gate: outside
// test mode ?args= is ignored, and the page passes -allowsharewarenet only when config.js says so.
SCENARIOS.gate = {
  what: 'the shareware gate (D14): with the default config.js a browser net game on the shareware GRP is refused on the overlay; the address cannot open it',
  run: async () => {
    let relay = null;
    try {
      CONFIG_ALLOW = false;
      relay = await startRelay(['-stats', '127.0.0.1:' + (PORT_BASE + 50)]);
      const m = await browserMachine('gate', gameArgs({ net: ['-relay', relay.ws, '-host-room', '2'], testsync: false }), { dump: 'd.bin' });
      await m.start();
      const st = await m.waitEnd(30000);
      const text = await m.status(), out = await m.out(), code = await m.exitCode();
      console.log('  default config: ' + text.replace(/\s+/g, ' ').slice(0, 160));
      check(st === 'error' && code === 1, 'refused: the game ended with status 1 (' + st + ', ' + code + ')');
      check(/Network games are switched off for the shareware version/.test(text), 'the overlay says why', text);
      check(/Network game refused/.test(out), 'and the game log says so');
      check(!/room code/.test(out), 'no room was made (the gate comes before the relay)');
      check(await m.page.evaluate(() => window.jfswArgs.indexOf('-allowsharewarenet') < 0), 'the page did not pass -allowsharewarenet');
      check(!(await m.page.evaluate(() => /allowsharewarenet/i.test(location.search))), 'and nothing in the address asked for it');
      const stats = await new Promise((resolve) => { require('http').get('http://127.0.0.1:' + (PORT_BASE + 50) + '/stats', (r) => { let t = ''; r.on('data', (d) => { t += d; }); r.on('end', () => { try { resolve(JSON.parse(t)); } catch (e) { resolve(null); } }); }).on('error', () => resolve(null)); });
      check(!!stats && stats.rooms_created === 0 && stats.websockets === 0, 'the relay never saw the machine: no room made, no connection (rooms_created ' + (stats && stats.rooms_created) + ', websockets ' + (stats && stats.websockets) + ')');
      await m.stop(); machines.splice(machines.indexOf(m), 1);
      // a visitor's address: no ?test=1 (and testMode false in config.js): ?args= is not read, so -allowsharewarenet cannot come from the address
      await closeEnv();
      CONFIG_ALLOW = false; CONFIG_TEST = false;
      const v = await browserMachine('visitor', [], { raw: '?args=' + encodeURIComponent('-allowsharewarenet -net -relay ' + relay.ws + ' -host-room 2') + '&allowsharewarenet=1&allowSharewareNetGames=true' });
      await v.start();
      await sleep(5000);
      const args = await v.page.evaluate(() => window.jfswArgs);
      check(Array.isArray(args) && args.length === 0, 'a visitor\'s address with ?args=-allowsharewarenet... starts the game with no arguments (' + JSON.stringify(args) + ')');
      check(!/room code/.test(await v.out()), 'and no network game starts');
    } finally { await cleanup(relay); }
  },
};

// The test-only relay knobs work only on a ?test=1 page.
SCENARIOS.knobs = {
  what: 'relay_wt, relay_cert, impair and wake_every are read from the address only with ?test=1',
  run: async () => {
    let relay = null;
    try {
      const e = await env();
      const knobs = '&relay_wt=' + encodeURIComponent('https://127.0.0.1:1/vnet') + '&relay_cert=' + 'ab'.repeat(32) + '&impair=' + encodeURIComponent('loss=50,seed=3') + '&wake_every=7';
      const read = async (q) => {
        const ctx = await e.browser.newContext();
        const page = await ctx.newPage();
        await page.goto(e.base + q);
        await L.waitState(page, 'ready', 60000);
        const r = await page.evaluate(() => ({ knobs: window.jfswKnobs, module: Module.jfswKnobs, wake: Module.jfswWakeEvery, test: typeof window.jfswTest }));
        await ctx.close();
        return r;
      };
      const off = await read('?args=-v1' + knobs);
      check(Object.keys(off.knobs).length === 0 && Object.keys(off.module).length === 0 && off.wake === undefined, 'without ?test=1 the page hands the game no knobs (' + JSON.stringify(off.knobs) + ')');
      check(off.test === 'undefined', 'and has no test hooks');
      const on = await read('?test=1&persist=0' + knobs);
      check(on.knobs.relay_wt === 'https://127.0.0.1:1/vnet' && on.knobs.relay_cert === 'ab'.repeat(32) && on.knobs.impair === 'loss=50,seed=3' && on.wake === 7, 'with ?test=1 all four reach the game (' + JSON.stringify(on.knobs) + ', wake every ' + on.wake + ')');
      // and the game acts on them: it says so, and a bad impairment spec is refused
      relay = await startRelay();
      const m = await browserMachine('knobs', gameArgs({ net: ['-relay', relay.ws, '-host-room', '2'], level: false, testsync: false }), { query: '&impair=' + encodeURIComponent('lat=5,seed=9') + '&relay_cert=' + relay.cert + '&relay_wt=' + encodeURIComponent(relay.wt), dump: 'd.bin' });
      await m.start();
      await waitRoomCode(m);
      const out = await m.out();
      check(/test knobs in use: relay_wt relay_cert impair/.test(out), 'the game reports the knobs it was given');
      check(/relay-wt/.test(out), 'the WebTransport knobs took effect (' + (await transportOf(m)) + ')');
      await m.stop(); machines.splice(machines.indexOf(m), 1);
      const bad = await browserMachine('badknob', gameArgs({ net: ['-relay', relay.ws, '-host-room', '2'], level: false, testsync: false }), { query: '&impair=' + encodeURIComponent('loss=banana'), dump: 'd.bin' });
      await bad.start();
      const st = await bad.waitEnd(20000);
      check(st === 'error' && /not a vnet impairment spec/.test(await bad.status()), 'a malformed impairment spec is refused with a message (' + (await bad.status()).slice(0, 120) + ')');
    } finally { await cleanup(relay); }
  },
};

// One longer game: co-op on E1L2, two players, 4000 tics (about 2 minutes), a browser and a native player through the relay.
SCENARIOS.long = {
  what: 'a longer game: two players, co-op on E1L2, 4000 tics, browser host and native slave',
  run: async () => {
    const o = { tics: 4000, level: '-v1 -l2 -c2' };
    const relay = await startRelay();
    try {
      console.log('  browser + native, co-op E1L2, ' + o.tics + ' tics (' + LOAD() + ')');
      const ms = await room(relay, ['browser', 'native'], o);
      const series = await sample(ms, o.tics, o.tics / NOMINAL * 1000 * 3 + 90000);
      for (const m of ms) { await m.waitEnd(60000); }
      console.log('  tic rates between tic 500 and 3500: ' + ms.map((m, i) => m.name + ' ' + rate(series[i], 500, 3500).toFixed(1)).join(', ') + ' (nominal ' + NOMINAL + '); ' + LOAD());
      await checkGame(ms, o.tics);
    } finally { await cleanup(relay); }
  },
};

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) { for (const k of Object.keys(SCENARIOS)) { console.log(k.padEnd(14) + SCENARIOS[k].what); } return 0; }
  const names = argv.length ? argv : Object.keys(SCENARIOS).filter((k) => !SCENARIOS[k].manual);
  for (const n of names) { if (!SCENARIOS[n]) { console.error('unknown scenario ' + n + ' (--list)'); return 2; } }
  for (const n of names) {
    console.log('\n== ' + n + ': ' + SCENARIOS[n].what);
    try { await SCENARIOS[n].run(); } catch (e) { check(false, n + ' ran to the end', e && e.stack || String(e)); try { await cleanup(null); } catch (e2) { /* best effort */ } }
  }
  return L.summary('netplay');
}
main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
