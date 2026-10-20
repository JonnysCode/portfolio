#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Boot profiler: where does the load time go?
//
//   node scripts/profile.mjs                       # high tier, 1280×720
//   node scripts/profile.mjs --quality medium --size 390x844
//   node scripts/profile.mjs --runs 2              # 2nd run = repeat visit (same browser profile)
//   node scripts/profile.mjs --cpu [--cpu-out p.cpuprofile]   # + sampled CPU profile, top self-time by file
//   node scripts/profile.mjs --glcalls             # + time spent inside WebGL calls (by entry point)
//   node scripts/profile.mjs --programs            # + per-program link wait (first info-log / link-status query)
//   node scripts/profile.mjs --url http://127.0.0.1:4173/   # profile a `vite preview` build
//
// Loads the page in headless Chromium (SwiftShader, like scripts/shots.mjs) with
// ?shots, waits for __woodland.ready and prints: the boot phases (performance
// marks `woodland:*` from src/main.js), per-module build times, JS heap after a
// forced GC, shader program count, and (with --cpu) the self time aggregated
// per source file and per function. SwiftShader makes GPU work (texture bakes,
// shader compiles) far slower than on real hardware; read the shape, not the
// absolute numbers.
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const all = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const [W, H] = String(opt('size', '1280x720')).split('x').map(Number);
const quality = String(opt('quality', 'high'));
const runs = Number(opt('runs', 1));
const cpu = opt('cpu', false);
const timeout = Number(opt('timeout', 900000));
const out = opt('out', null);

let server = null;
let url = opt('url', null);
if (!url) {
  server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false, watch: null } });
  await server.listen();
  url = `http://127.0.0.1:${server.httpServer.address().port}/`;
}
const q = new URLSearchParams({ shots: '1', q: quality, night: opt('night', false) ? '1' : '0' });
for (const kv of all('param')) {
  const [k, v = '1'] = String(kv).split('=');
  q.set(k, v);
}

const userDir = await mkdtemp(path.join(os.tmpdir(), 'woodland-profile-'));
const context = await chromium.launchPersistentContext(userDir, {
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--js-flags=--expose-gc', '--enable-precise-memory-info'],
});
const report = [];
let exitCode = 0;
try {
  for (let run = 1; run <= runs; run++) {
    const page = await context.newPage();
    const problems = [];
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(m.text());
      if (opt('verbose', false)) console.log(`  [page] ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(String(e.stack || e)));
    if (opt('programs', false)) {
      // time every program's compile + link on its own (each link is waited for right away —
      // serialises compilation, so total boot time is NOT representative in this mode)
      await page.addInitScript(() => {
        const times = (window.__programTimes = new WeakMap());
        const P = WebGL2RenderingContext.prototype;
        const origLink = P.linkProgram;
        const origParam = P.getProgramParameter;
        P.linkProgram = function (prog) {
          const t = performance.now();
          origLink.call(this, prog);
          origParam.call(this, prog, this.LINK_STATUS);
          times.set(prog, performance.now() - t);
        };
      });
    }
    if (opt('glcalls', false)) {
      // total time spent inside each blocking-prone WebGL entry point
      await page.addInitScript(() => {
        const acc = (window.__glCalls = {});
        const P = WebGL2RenderingContext.prototype;
        for (const name of ['getProgramInfoLog', 'getShaderInfoLog', 'getProgramParameter', 'getShaderParameter', 'getActiveUniform', 'getUniformLocation', 'getActiveAttrib', 'getAttribLocation', 'linkProgram', 'compileShader', 'readPixels', 'bufferData', 'texImage2D', 'texStorage2D', 'generateMipmap', 'drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'getError', 'getExtension', 'getParameter', 'clear', 'checkFramebufferStatus']) {
          const orig = P[name];
          if (!orig) continue;
          P[name] = function (...a) {
            const t = performance.now();
            try {
              return orig.apply(this, a);
            } finally {
              const e = (acc[name] ??= { n: 0, ms: 0 });
              e.n++;
              e.ms += performance.now() - t;
            }
          };
        }
      });
    }
    const cdp = await page.context().newCDPSession(page);
    if (cpu) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
      await cdp.send('Profiler.start');
    }
    const t0 = Date.now();
    await page.goto(url + '?' + q.toString(), { waitUntil: 'load', timeout });
    await page.waitForFunction(() => window.__woodland?.ready === true, null, { timeout, polling: 200 });
    const wall = Date.now() - t0;
    let profile = null;
    if (cpu) profile = (await cdp.send('Profiler.stop')).profile;
    await cdp.send('HeapProfiler.enable');
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const info = await page.evaluate(() => {
      const w = window.__woodland;
      const marks = performance.getEntriesByType('mark').filter((m) => m.name.startsWith('woodland:')).map((m) => [m.name.slice(9), Math.round(m.startTime)]);
      const measures = performance.getEntriesByType('measure').filter((m) => m.name.startsWith('woodland:')).map((m) => [m.name.slice(9), Math.round(m.duration)]);
      const r = w.ctx.engine.renderer;
      return {
        marks,
        measures,
        build: w.ctx.buildReport?.ok?.map((b) => `${b.id}:${b.ms}`).join(' '),
        programs: r.info.programs?.length,
        textures: r.info.memory.textures,
        geometries: r.info.memory.geometries,
        cache: w.ctx.bootCache ?? null,
        glCalls: window.__glCalls ? Object.entries(window.__glCalls).sort((a, b) => b[1].ms - a[1].ms).map(([k, v]) => `${k} ×${v.n} ${Math.round(v.ms)}ms`) : null,
        cpuArrays: (() => {
          // CPU-side copies of vertex/index/instance data still held after upload (not in the V8 heap figure)
          const seen = new Set();
          let bytes = 0;
          const add = (a) => {
            const buf = a?.array?.buffer;
            if (buf && !seen.has(buf)) {
              seen.add(buf);
              bytes += buf.byteLength;
            }
          };
          const perModule = {};
          for (const [id, roots] of Object.entries(w.ctx.moduleRoots ?? {})) {
            const before = bytes;
            for (const r of roots)
              r.traverse((o) => {
                const g = o.geometry;
                if (g) {
                  for (const at of Object.values(g.attributes)) add(at.isInterleavedBufferAttribute ? at.data : at);
                  add(g.index);
                }
                if (o.isInstancedMesh) {
                  add(o.instanceMatrix);
                  add(o.instanceColor);
                }
              });
            perModule[id] = +((bytes - before) / 1048576).toFixed(1);
          }
          return { totalMB: +(bytes / 1048576).toFixed(1), perModule };
        })(),
        programList: window.__programTimes
          ? r.info.programs.map((p) => ({ name: p.name, ms: Math.round(window.__programTimes.get(p.program) ?? -1), key: p.cacheKey }))
          : null,
      };
    });
    const row = { run, wall, heapMB: +(heap.usedSize / 1048576).toFixed(1), ...info, errors: problems.length };
    report.push(row);
    console.log(`\n── run ${run}: ready in ${wall} ms · heap ${row.heapMB} MB after GC · ${info.programs} programs · ${info.textures} textures · ${info.geometries} geometries`);
    console.log(`  cpu-side geometry arrays: ${info.cpuArrays.totalMB} MB ${JSON.stringify(info.cpuArrays.perModule)}`);
    for (const [n, t] of info.marks) console.log(`  mark  ${n.padEnd(28)} ${String(t).padStart(7)} ms`);
    for (const [n, t] of info.measures) console.log(`  span  ${n.padEnd(28)} ${String(t).padStart(7)} ms`);
    console.log(`  build ${info.build}`);
    if (info.glCalls) console.log(`  gl calls: ${info.glCalls.join(' · ')}`);
    if (info.cache) console.log(`  cache ${JSON.stringify(info.cache)}`);
    if (info.programList) {
      const list = info.programList.sort((a, b) => b.ms - a.ms);
      console.log(`  programs (link wait, ms) — total ${list.reduce((s, p) => s + Math.max(0, p.ms), 0)} ms:`);
      for (const p of list) console.log(`    ${String(p.ms).padStart(6)}  ${p.name}`);
    }
    if (problems.length) {
      exitCode = 1;
      console.log(`  ${problems.length} console error(s):\n    ` + problems.slice(0, 20).join('\n    '));
    }
    if (profile) {
      summarise(profile);
      if (opt('cpu-out', null)) await writeFile(String(opt('cpu-out')), JSON.stringify(profile));
    }
    await page.close();
  }
} catch (err) {
  exitCode = 1;
  console.log('[profile error]', err.stack || err.message);
} finally {
  if (out) await writeFile(String(out), JSON.stringify(report, null, 2));
  await context.close();
  if (server) await server.close();
  process.exit(exitCode);
}

/** Self time per source file and per function from a CPU profile. */
function summarise(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + (dt[i] ?? 0) / 1000);
  const files = new Map();
  const fns = new Map();
  for (const [id, ms] of self) {
    const n = byId.get(id);
    const f = n.callFrame;
    const file = f.url ? f.url.replace(/^https?:\/\/[^/]+\//, '').replace(/\?.*$/, '') : `(${f.functionName || 'native'})`;
    files.set(file, (files.get(file) ?? 0) + ms);
    const key = `${f.functionName || '(anon)'} ${file}:${f.lineNumber + 1}`;
    fns.set(key, (fns.get(key) ?? 0) + ms);
  }
  const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k);
  console.log('  self time by file:');
  for (const [f, ms] of top(files, 30)) console.log(`    ${ms.toFixed(0).padStart(7)} ms  ${f}`);
  console.log('  self time by function:');
  for (const [f, ms] of top(fns, 40)) console.log(`    ${ms.toFixed(0).padStart(7)} ms  ${f}`);
}
