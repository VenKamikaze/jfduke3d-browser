#!/usr/bin/env node
// Quick test (no browser, no game data needed except for the timing line): the page's table of known GRPs
// (web/grptable.js) agrees with src/grpscan.c, config.js declares a file that table knows, and the page's
// CRC-32 gives the same answers as zlib's.
//
//   node tests/web/grptable.js           check
//   node tests/web/grptable.js --write   regenerate web/grptable.js from src/grpscan.c (then check)
//
// web/grptable.js is generated from the table in grpscan.c: when a GRP is added there, run --write.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const t = require('./lib.js');

const root = t.root;

// The rows of grpfiles[] in grpscan.c: { "name", 0xCRC32, size, GAMEGRP_GAME_<kind>, "file", NULL, NULL }.
function parseC(src) {
  const rows = [];
  const re = /\{\s*"([^"]+)",\s*0x([0-9A-Fa-f]+),\s*(\d+),\s*GAMEGRP_GAME_(\w+)\s*,\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src))) { rows.push({ name: m[1], crc: m[2].toLowerCase(), size: +m[3], game: m[4], file: m[5] }); }
  return rows;
}
function generate(rows) {
  return '// The GRP files the game knows: a copy of the grpfiles[] table in src/grpscan.c (name, CRC-32, size, kind, file name).\n' +
    '// Generated: node tests/web/grptable.js --write. tests/web/grptable.js checks the two against each other, so they cannot drift apart.\n' +
    '//   game: DUKE (registered), DUKESW (shareware), NAM, as GAMEGRP_GAME_* in grpscan.c.\n' +
    '// The page starts the game with DUKE and DUKESW entries only (NAM is for later).\n' +
    'window.JFSW_GRPS = [\n' +
    rows.map((r) => `  { name: ${JSON.stringify(r.name).replace(/"/g, "'")}, crc: '${r.crc}', size: ${r.size}, game: '${r.game}', file: '${r.file}' },\n`).join('') +
    '];\n';
}
function load(file, extra) {
  const sandbox = Object.assign({ window: {}, performance, URL, location: { href: 'http://x/', origin: 'http://x' } }, extra);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'web', file), 'utf8'), sandbox, { filename: file });
  return sandbox.window;
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const c = parseC(fs.readFileSync(path.join(root, 'src', 'grpscan.c'), 'utf8'));
if (process.argv.includes('--write')) { fs.writeFileSync(path.join(root, 'web', 'grptable.js'), generate(c)); console.log('wrote web/grptable.js'); }
const js = load('grptable.js').JFSW_GRPS;
const key = (r) => ({ name: r.name, crc: r.crc, size: r.size, game: r.game, file: r.file });
t.check(c.length >= 7, `grpscan.c: found ${c.length} table rows`);
t.check(same(c.map(key), js.map(key)), 'web/grptable.js is the same table as grpscan.c (name, CRC32, size, kind, file name)');
t.check(fs.readFileSync(path.join(root, 'web', 'grptable.js'), 'utf8') === generate(c), 'web/grptable.js is exactly what --write generates (so it was not edited by hand)');
// The comparison can fail: one digit of a CRC32, one size, one extra row.
const bad1 = js.map(key); bad1[1].crc = '08a7fa1e';
const bad2 = js.map(key); bad2[0].size += 1;
t.check(!same(c.map(key), bad1) && !same(c.map(key), bad2) && !same(c.map(key), js.slice(1).map(key)), 'the comparison notices a changed CRC32, a changed size and a missing row');
// The parser itself: a row it cannot read would silently shorten the table, so count the rows in the C text.
const cRows = (fs.readFileSync(path.join(root, 'src', 'grpscan.c'), 'utf8').match(/^\s*\{\s*"[^"]+",\s*0x/gm) || []).length;
t.check(cRows === c.length, `every row of grpfiles[] was parsed (${cRows} found by a second count)`);

const win = load('config.js');
const cfg = win.JFSW_CONFIG.data;
const entry = js.find((g) => g.crc === cfg.crc32 && g.size === cfg.size);
t.check(entry && entry.game === 'DUKESW', 'config.js declares a shareware GRP the table knows', JSON.stringify(cfg));
t.check(win.JFSW_CONFIG.allowSharewareNetGames === false && win.JFSW_CONFIG.testMode === false && win.JFSW_CONFIG.relay === '', 'config.js ships with the safe defaults (allowSharewareNetGames false, testMode false, no relay)');

// data.js reads window.JFSW_GRPS when it loads, so both go in one context.
const sb = { window: {}, performance, URL, location: { href: 'http://x/', origin: 'http://x' } };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(root, 'web', 'grptable.js'), 'utf8'), sb);
vm.runInContext(fs.readFileSync(path.join(root, 'web', 'data.js'), 'utf8'), sb);
const D = sb.window.JfswData;
const check9 = D.crc32(new Uint8Array(Buffer.from('123456789')));
t.check(check9 === 0xCBF43926, 'page CRC-32 of "123456789" is the standard 0xCBF43926', check9.toString(16));
for (const n of [0, 1, 3, 4, 5, 7, 8, 1000, 65537]) {
  const b = require('crypto').randomBytes(n);
  if (D.crc32(new Uint8Array(b)) !== zlib.crc32(b)) { t.check(false, `page CRC-32 equals zlib's for ${n} random bytes`); }
}
t.check(true, "page CRC-32 equals zlib's for random inputs of 0 to 65537 bytes (all tail lengths)");
t.check(D.identify(0x983AD923, 11035779).name === 'Shareware Version' && D.identify(0x983AD923, 11035778) === null, 'identify() needs both CRC32 and size');
t.check(D.identify(0x982AFE4A, 44356548).name === '20th Anniversary' && D.identify(0xFD3DCFF1, 44356548).name === 'Registered Version 1.5', 'two GRPs of the same size are told apart by their CRC32');
if (fs.existsSync(t.GRP)) {
  const g = new Uint8Array(fs.readFileSync(t.GRP));
  let best = 1e9;
  for (let i = 0; i < 5; i++) { const t0 = performance.now(); const v = D.crc32(g); best = Math.min(best, performance.now() - t0); if (i === 0) { t.check(v === 0x983AD923, 'page CRC-32 of testdata/duke3dshare.grp is 0x983AD923'); } }
  console.log(`  info: CRC-32 of ${g.length} bytes in node: best of 5 ${best.toFixed(0)} ms`);
}
process.exit(t.summary('grptable'));
