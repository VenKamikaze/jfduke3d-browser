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
  if (o.dump) { a.push('-testdump' + o.dump); a.push(...(o.state ? ['-teststate'] : STATE_ARGS)); }
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
    }
    check(!/different versions/.test(out), m.name + ' saw no version mismatch');
    check(m.errors.length === 0, m.name + ' had no page errors', m.errors.join('; '));
    dumps.push(await m.readDump());
  }
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
