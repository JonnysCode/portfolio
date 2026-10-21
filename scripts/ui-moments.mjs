#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// UI moments the ?shots harness skips: the loading screen and the intro card
// (real boot, no ?shots). Screenshots the loader early, then the intro card
// once it is up, then the HUD after "Enter".
//
//   node scripts/ui-moments.mjs [--size 1280x720] [--prefix ui-] [--params night=1] [--touch]
//        [--url http://127.0.0.1:4173/]   (a running server, e.g. `vite preview` of a build)
// ─────────────────────────────────────────────────────────────────────────────
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i < 0 ? d : args[i + 1];
};
const [W, H] = String(opt('size', '1280x720')).split('x').map(Number);
const prefix = opt('prefix', 'ui-');
const touch = args.includes('--touch');
const base = opt('url', null);
const server = base ? null : await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
await server?.listen();
const url = `${base ?? `http://127.0.0.1:${server.httpServer.address().port}/`}?q=low&${opt('params', '')}`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch });
const problems = [];
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.stack || e.message}`));
page.on('console', (m) => m.type() === 'error' && problems.push(`[console.error] ${m.text()}`));
const out = (n) => path.join(root, 'shots', `${prefix}${n}.png`);
await mkdir(path.join(root, 'shots'), { recursive: true });
try {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.loader', { timeout: 60000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: out('loader'), timeout: 300000 });
  // pin a mid-way progress so the art is visible in its "growing" state
  await page.waitForFunction(() => Number(document.querySelector('.loader [role=progressbar]')?.getAttribute('aria-valuenow')) >= 30, null, { timeout: 600000, polling: 250 }).catch(() => {});
  await page.screenshot({ path: out('loader-mid'), timeout: 300000 });
  await page.waitForSelector('.intro__card', { timeout: 900000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out('intro'), timeout: 300000 });
  await page.evaluate(() => document.querySelector('.intro .stamp-btn.is-primary').click());
  await page.waitForTimeout(3500);
  await page.screenshot({ path: out('flying'), timeout: 300000 });
  console.log('ok');
} finally {
  if (problems.length) console.log(problems.join('\n'));
  await browser.close();
  await server?.close();
}
