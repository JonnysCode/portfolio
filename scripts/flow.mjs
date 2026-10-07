#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Multi-step interaction flow harness: boots the glen ONCE, then runs a list of
// steps (evaluate JS in the page, click, press keys, move the mouse, advance
// frames) and screenshots each named step. Complements scripts/shots.mjs.
//
//   node scripts/flow.mjs scripts/flows/tour.json [--size 1280x720] [--params night=1]
//        [--prefix flow-] [--touch] [--reduced]
//
// A step: { "name": "shot-name", "eval": "<js>", "click": [x, y], "key": "ArrowRight",
//           "move": [x, y], "moveEval": "<js returning [x, y]>", "after": "<js>",
//           "wait": ms, "render": frames, "shot": false }
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i < 0 ? d : args[i + 1];
};
const steps = JSON.parse(await readFile(args[0], 'utf8'));
const [W, H] = String(opt('size', '1280x720')).split('x').map(Number);
const prefix = opt('prefix', 'experience-flow-');
const extra = opt('params', '');
const touch = args.includes('--touch');
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
if (args.includes('--reduced')) await page.emulateMedia({ reducedMotion: 'reduce' });
const problems = [];
const IGN = [/KHR_parallel_shader_compile/, /GPU stall due to ReadPixels/, /Automatic fallback to software WebGL/];
page.on('console', (m) => {
  const t = m.type();
  if ((t === 'error' || t === 'warning') && !IGN.some((re) => re.test(m.text()))) problems.push(`[console.${t}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.stack || e.message}`));
const q = `shots=1&q=high&night=0${extra ? '&' + extra : ''}`;
const t0 = Date.now();
const stamp = () => ((Date.now() - t0) / 1000).toFixed(0) + 's';
try {
  await page.goto(url + '?' + q, { waitUntil: 'load', timeout: 900000 });
  await page.waitForFunction(() => window.__woodland?.ready === true, null, { timeout: 900000, polling: 250 });
  console.log(`[boot] ${Date.now() - t0} ms`);
  await mkdir(path.join(root, 'shots'), { recursive: true });
  for (const s of steps) {
    if (s.eval) {
      const r = await page.evaluate(s.eval);
      if (r !== undefined) console.log(`[${s.name ?? 'eval'}]`, JSON.stringify(r));
    }
    if (s.click) await page.mouse.click(s.click[0], s.click[1]);
    if (s.key) await page.keyboard.press(s.key);
    if (s.moveEval) {
      const p = await page.evaluate(s.moveEval);
      console.log(`[move ${s.name}]`, JSON.stringify(p));
      if (p) await page.mouse.move(p[0], p[1], { steps: 3 });
    }
    if (s.after) {
      const r = await page.evaluate(s.after);
      if (r !== undefined) console.log(`[${s.name ?? 'after'}]`, JSON.stringify(r));
    }
    if (s.move) await page.mouse.move(s.move[0], s.move[1], { steps: 4 });
    if (s.wait) await page.waitForTimeout(s.wait);
    if (s.render) await page.evaluate((n) => window.__woodland.debug.step(n), s.render);
    if (s.name && s.shot !== false) {
      const f = path.join(root, 'shots', `${prefix}${s.name}.png`);
      await page.screenshot({ path: f, timeout: 900000 });
      console.log(`[shot] ${f} @${stamp()}`);
    }
  }
  const stats = await page.evaluate(() => window.__woodland.debug.stats());
  console.log('[stats]', JSON.stringify({ ...stats, build: undefined }));
  if (stats.build.failed.length) for (const f of stats.build.failed) console.log(`[build FAILED] ${f.id}\n${f.error.slice(0, 600)}`);
} catch (e) {
  console.log('[error]', e.stack || e.message);
} finally {
  console.log(problems.length ? problems.slice(0, 40).join('\n') : 'no console problems');
  await browser.close();
  await server.close();
}
