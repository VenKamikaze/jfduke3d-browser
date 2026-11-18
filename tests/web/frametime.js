#!/usr/bin/env node
// Frame times while E1L1 is played (brief 02, jfSW's frame-time check; its home there is determinism.js, which Duke gets later).
//
//   node tests/web/frametime.js
//
// Turns in place and walks for 40 s in the first level (the keyboard held down; nothing to shoot at), then reports the intervals between
// presented frames: median, 95th and 99th percentile and maximum, after the first 10 s. The target is a median at 60 Hz (about 16.7 ms)
// and no stall over 100 ms. THE STALL CHECK FAILS in the cloud container: a software-rendered headless Chromium on a few shared cores
// stalls for over 100 ms now and then (max 300 ms or more, a dozen gaps over 100 ms in 40 s), while the game itself uses about 1.5 ms of
// each frame. It is kept and not loosened: it needs a run on real hardware (the play-test steps in the Outcome of brief 02).
// Port 49106.
'use strict';
const os = require('os');
const t = require('./lib.js');

const PORT = t.port(49106);
async function main() {
  const env = await t.start(PORT);
  try {
    const { page, errors } = await t.open(env, '?test=1&persist=0&args=' + encodeURIComponent('-v1 -l1 -s1'));
    await t.waitState(page, 'ready');
    await page.click('#start');
    await page.waitForTimeout(6000);
    await page.evaluate(() => { Module.jfswFrameLog.length = 0; });
    const t0 = await page.evaluate(() => performance.now());
    await page.keyboard.down('ArrowUp');
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(40000);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('ArrowUp');
    const frames = (await page.evaluate(() => Module.jfswFrameLog.slice())).map((x) => x - t0);
    const used = frames.filter((x) => x >= 4000);      // after the first seconds
    const d = [];
    for (let i = 1; i < used.length; i++) { d.push(used[i] - used[i - 1]); }
    d.sort((a, b) => a - b);
    const span = (used[used.length - 1] - used[0]) / 1000;
    const stats = { frames: used.length, seconds: +span.toFixed(1), median: d[Math.floor(d.length / 2)], p95: t.pct(d, 0.95), p99: t.pct(d, 0.99), max: d[d.length - 1] };
    console.log('  frame intervals (ms): ' + JSON.stringify(stats) + ' load average ' + os.loadavg().map((x) => x.toFixed(1)).join(' ') + ' on ' + os.cpus().length + ' cores');
    t.check(span >= 30, `frame times: at least 30 s measured (${span.toFixed(0)} s, ${used.length} frames)`);
    t.check(stats.median < 18, `frame times: median ${stats.median.toFixed(1)} ms (target about 16.7)`);
    t.check(stats.max < 100, `frame times: no stall over 100 ms (max ${stats.max.toFixed(0)} ms, p99 ${stats.p99.toFixed(1)} ms)`);
    t.check(errors.length === 0, 'no page error', errors.join(' | '));
  } finally { await t.stop(env); }
  return t.summary('frametime');
}
main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
