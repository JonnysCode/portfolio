#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Screenshot & smoke-test harness.
//
//   npm run shots                                  # default set of views
//   npm run shots -- --views woodworking,bikes-close --night
//   npm run shots -- --views spawn --ui --panel dining-table
//   npm run shots -- --custom "bench:2,3,-30:0,1,-36" --size 1600x900
//   npm run shots -- --eval "__woodland.debug.teleportToArea('bikes')" --views free
//
// Starts a Vite dev server on a free port (or uses --url), loads the page in
// headless Chromium (SwiftShader WebGL) with ?shots, waits for the world to be
// ready, then renders each view to shots/<prefix><view>.png. Prints console
// errors, failed modules and render stats. Exits 1 on any page error unless
// --allow-errors is given.
//
// Views: overview, spawn, pond, <area>, <area>-close, <area>-high for every
// area (plaza, woodworking, bikes, interior, code, home) and "free" (whatever the
// camera rig currently shows, e.g. after --eval teleport).
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
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

const views = String(opt('views', 'overview,spawn,plaza,woodworking,bikes,interior,code,home,pond')).split(',').filter(Boolean);
const customs = all('custom'); // "name:px,py,pz:tx,ty,tz"
const [W, H] = String(opt('size', '1280x720')).split('x').map(Number);
const outDir = path.resolve(root, String(opt('out', 'shots')));
const prefix = String(opt('prefix', ''));
const night = opt('night', false);
const showUI = opt('ui', false);
const panel = opt('panel', null);
const evals = all('eval');
const frames = Number(opt('frames', 4));
const quality = opt('quality', 'high');
const allowErrors = opt('allow-errors', false);
const timeout = Number(opt('timeout', 120000));

let server = null;
let url = opt('url', null);
if (!url) {
  server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', strictPort: false } });
  await server.listen();
  const addr = server.httpServer.address();
  url = `http://127.0.0.1:${addr.port}/`;
}

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const problems = [];
// Environment noise from headless SwiftShader, not from our code.
const IGNORED = [/KHR_parallel_shader_compile/, /GPU stall due to ReadPixels/, /Automatic fallback to software WebGL/];
page.on('console', (m) => {
  const t = m.type();
  if ((t === 'error' || t === 'warning') && !IGNORED.some((re) => re.test(m.text()))) problems.push(`[console.${t}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.stack || e.message}`));
page.on('requestfailed', (r) => problems.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

const q = new URLSearchParams({ shots: '1', q: String(quality) });
q.set('night', night ? '1' : '0');
const t0 = Date.now();
let exitCode = 0;
try {
  await page.goto(url + '?' + q.toString(), { waitUntil: 'load', timeout });
  await page.waitForFunction(() => window.__woodland?.ready === true, null, { timeout, polling: 250 });
  const bootMs = Date.now() - t0;
  if (!showUI && !panel) await page.addStyleTag({ content: '#ui{display:none!important}' });
  for (const code of evals) {
    const r = await page.evaluate(code);
    if (r !== undefined) console.log(`[eval] ${JSON.stringify(r)}`);
  }
  if (panel) await page.evaluate((id) => window.__woodland.debug.openEntry(id), panel);
  await mkdir(outDir, { recursive: true });

  const jobs = [
    ...views.map((v) => ({ name: v, def: v === 'free' ? null : v })),
    ...customs.map((c) => {
      const [name, p, t] = c.split(':');
      return { name, def: { position: p.split(',').map(Number), target: t.split(',').map(Number) } };
    }),
  ];
  for (const job of jobs) {
    await page.evaluate(({ def, frames }) => {
      const d = window.__woodland.debug;
      if (def) d.view(def);
      else d.free();
      d.step(frames);
    }, { def: job.def, frames });
    await page.waitForTimeout(60);
    const file = path.join(outDir, `${prefix}${job.name}.png`);
    await page.screenshot({ path: file });
    console.log(`[shot] ${path.relative(root, file)}`);
  }
  const stats = await page.evaluate(() => window.__woodland.debug.stats());
  console.log(`[boot] ready in ${bootMs} ms`);
  console.log('[stats]', JSON.stringify({ ...stats, build: undefined }));
  console.log('[build ok]', stats.build.ok.map((b) => `${b.id}:${b.ms}ms`).join(' '));
  if (stats.build.failed.length) {
    exitCode = 1;
    for (const f of stats.build.failed) console.log(`[build FAILED] ${f.id}\n${f.error}`);
  }
} catch (err) {
  exitCode = 1;
  console.log('[harness error]', err.stack || err.message);
} finally {
  if (problems.length) {
    console.log(`\n${problems.length} console problem(s):`);
    for (const p of [...new Set(problems)].slice(0, 60)) console.log('  ' + p);
    if (problems.some((p) => !p.startsWith('[console.warning]')) && !allowErrors) exitCode = 1;
  } else {
    console.log('no console errors or warnings');
  }
  await browser.close();
  if (server) await server.close();
  process.exit(exitCode);
}
