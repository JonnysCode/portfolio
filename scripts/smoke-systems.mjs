#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Systems smoke test — walks, routes, rides and camera moves, driven frame by
// frame in headless Chromium (same setup as scripts/shots.mjs).
//
//   node scripts/smoke-systems.mjs                     # every scenario
//   node scripts/smoke-systems.mjs --only ride,walk    # a subset
//   node scripts/smoke-systems.mjs --no-shots          # assertions only (fast)
//
// Screenshots land in shots/smoke-<scenario>-<label>.png. Exits 1 if a check
// fails or the page logs an error.
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
const only = opt('only', null) ? String(opt('only')).split(',') : null;
const noShots = opt('no-shots', false);
const mobile = !!opt('mobile', false);
const [W, H] = String(opt('size', mobile ? '390x844' : '1280x720')).split('x').map(Number);
const prefix = String(opt('prefix', 'smoke-'));
const outDir = path.resolve(root, 'shots');

const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1', hmr: false, watch: null } });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}/`;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
const problems = [];
const IGNORED = [/KHR_parallel_shader_compile/, /GPU stall due to ReadPixels/, /Automatic fallback to software WebGL/];
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !IGNORED.some((re) => re.test(m.text()))) problems.push(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.stack || e.message}`));

await page.goto(url + '?shots=1&q=' + String(opt('quality', 'high')), { waitUntil: 'load' });
await page.waitForFunction(() => window.__woodland?.ready === true, null, { timeout: 120000, polling: 250 });
await page.addStyleTag({ content: '#ui{display:none!important}' }).then((h) => h.evaluate((el) => (el.id = 'hide-ui')));
const showUI = (on) => page.evaluate((v) => (document.getElementById('hide-ui').disabled = v), on);
await mkdir(outDir, { recursive: true });

// helpers installed in the page
await page.evaluate(() => {
  const w = window.__woodland;
  const { ctx, debug } = w;
  /** Step `seconds` of simulated time; microtasks flush between frames. */
  w.sim = async (seconds, dt = 1 / 60) => {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) {
      ctx.engine.step(dt, i === n - 1);
      if (i % 10 === 0) await null;
    }
  };
  /** Step until fn() is truthy (or timeout seconds). Returns the elapsed sim time. */
  w.simUntil = async (fn, timeout = 30, dt = 1 / 60) => {
    let t = 0;
    while (t < timeout) {
      ctx.engine.step(dt, false);
      t += dt;
      await null;
      if (fn()) break;
    }
    ctx.engine.step(dt, true);
    return t;
  };
  w.p = () => {
    const p = ctx.player.position;
    return { x: +p.x.toFixed(2), z: +p.z.toFixed(2), area: ctx.player.area };
  };
  debug.free();
});

let failed = 0;
const check = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failed++;
};
const shot = async (scenario, label) => {
  if (noShots) return;
  const file = path.join(outDir, `${prefix}${scenario}-${label}.png`);
  await page.evaluate(() => window.__woodland.ctx.engine.step(1 / 60, true));
  await page.screenshot({ path: file });
  console.log(`  [shot] ${path.relative(root, file)}`);
};
const ev = (fn, arg) => page.evaluate(fn, arg);

const scenarios = {
  async nav() {
    const r = await ev(() => {
      const { ctx } = window.__woodland;
      const nav = ctx.player.nav;
      nav.ensure();
      const t0 = performance.now();
      const route = nav.findPath(0, 8, 0, -40);
      const ms = performance.now() - t0;
      const pond = nav.findPath(2, 28, 3, 54);
      const blocked = nav.findPath(0, 8, 2, 41); // the middle of the pond
      return {
        buildMs: Math.round(nav.buildMs), searchMs: +ms.toFixed(2), len: route?.length, pts: route?.points.length,
        pondLen: pond?.length, pondPts: pond?.points.length, pondReached: pond?.reached,
        blockedReached: blocked?.reached, blockedEnd: blocked?.end,
        pondClear: pond?.points.every((p) => Math.hypot(p.x - 2, p.z - 41) > 7.5),
      };
    });
    console.log('  ', JSON.stringify(r));
    check(r.len > 0, 'spawn → woodworking route exists');
    check(r.pondReached && r.pondLen > 26 && r.pondClear, 'route across the pond goes around it');
    check(r.blockedReached === false && r.blockedEnd, 'blocked target → nearest reachable spot');
  },

  async walk() {
    await ev(() => {
      const { debug, ctx } = window.__woodland;
      debug.teleport(2, 28, Math.PI);
      ctx.player.moveTo(3, 54);
    });
    await ev(() => window.__woodland.sim(1.0));
    await ev(() => window.__woodland.debug.view({ position: [2, 30, 64], target: [2, 0, 41] }));
    await shot('walk', 'pond-detour');
    const t = await ev(() => window.__woodland.simUntil(() => !window.__woodland.ctx.player.route, 30));
    const p = await ev(() => window.__woodland.p());
    console.log(`   arrived after ${t.toFixed(1)}s at`, JSON.stringify(p));
    check(Math.hypot(p.x - 3, p.z - 54) < 0.6, 'player walked around the pond to the target');
    await ev(() => window.__woodland.debug.free());
  },

  async keys() {
    const r = await ev(async () => {
      const w = window.__woodland;
      w.debug.teleport(0, 6, Math.PI);
      w.debug.step(2);
      const start = w.p();
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW' }));
      await w.sim(1.0);
      const mid = w.ctx.player.speed;
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW' }));
      await w.sim(0.6);
      return { start, end: w.p(), mid: +mid.toFixed(2), after: w.ctx.player.speed };
    });
    console.log('  ', JSON.stringify(r));
    check(r.mid > 3.5 && r.end.z < r.start.z - 2.5, 'W walks away from the camera (towards −Z)');
    check(r.after < 0.05, 'decelerates to a stop after key release');
  },

  async ride() {
    await ev(() => {
      const w = window.__woodland;
      w.debug.teleport(-1.5, 6.5, Math.PI);
      w.trip = w.ctx.transport.travelTo('bikes');
      w.arrived = null;
      w.trip.then((ok) => (w.arrived = ok));
    });
    await ev(() => window.__woodland.simUntil(() => window.__woodland.ctx.player.riding, 15));
    await shot('ride', '1-mounted');
    await ev(() => window.__woodland.simUntil(() => window.__woodland.ctx.transport.trip?.phase === 'ride', 5));
    await ev(() => window.__woodland.sim(2.2));
    await shot('ride', '2-crawling');
    await ev(() => window.__woodland.sim(1.8));
    await shot('ride', '3-path');
    const t = await ev(() => window.__woodland.simUntil(() => window.__woodland.arrived !== null, 40));
    await ev(() => window.__woodland.sim(0.4));
    await shot('ride', '4-arrived');
    const r = await ev(() => ({ p: window.__woodland.p(), arrived: window.__woodland.arrived, busy: window.__woodland.ctx.transport.busy }));
    console.log(`   trip ended after +${t.toFixed(1)}s`, JSON.stringify(r));
    check(r.arrived === true && r.p.area === 'bikes' && !r.busy, 'rode plaza → bikes and hopped off in the district');
    // the empty snail heads home
    await ev(() => window.__woodland.sim(3));
    await shot('ride', '5-snail-going-home');
    const st = await ev(() => window.__woodland.ctx.transport.stations.find((s) => s.areaId === 'plaza').state);
    check(st === 'returning' || st === 'home', `plaza snail is ${st}`);
  },

  async cross() {
    const r = await ev(async () => {
      const w = window.__woodland;
      w.debug.teleportToArea('home');
      await w.sim(0.2);
      const route = w.ctx.transport.routeBetween('home', 'code');
      w.arrived = null;
      w.ctx.transport.travelTo('code').then((ok) => (w.arrived = ok));
      return { len: route.length };
    });
    console.log('   home → code route length', r.len.toFixed(1));
    await ev(() => window.__woodland.simUntil(() => window.__woodland.ctx.transport.trip?.phase === 'ride', 20));
    await ev(() => window.__woodland.sim(4.5));
    await shot('cross', '1-leaving-home');
    await ev(() => window.__woodland.simUntil(() => Math.hypot(window.__woodland.ctx.player.position.x, window.__woodland.ctx.player.position.z) < 9, 30));
    await shot('cross', '2-plaza');
    await ev(() => window.__woodland.debug.view({ position: [0, 60, 30], target: [0, 0, 0] }));
    await shot('cross', '3-plaza-top');
    await ev(() => window.__woodland.debug.free());
    await ev(() => window.__woodland.simUntil(() => window.__woodland.arrived !== null, 40));
    const p = await ev(() => window.__woodland.p());
    check(p.area === 'code', `district → district ride arrives in code (area ${p.area})`);
  },

  async skip() {
    const r = await ev(async () => {
      const w = window.__woodland;
      w.debug.teleportToArea('interior');
      await w.sim(0.2);
      w.arrived = null;
      w.ctx.transport.travelTo('woodworking').then((ok) => (w.arrived = ok));
      await w.simUntil(() => w.ctx.transport.trip?.phase === 'ride', 20);
      await w.sim(1);
      w.ctx.transport.skip();
      const t = await w.simUntil(() => w.arrived !== null, 10);
      return { t, p: w.p() };
    });
    console.log('  ', JSON.stringify(r));
    check(r.p.area === 'woodworking' && r.t < 4, 'skip jumps to the arrival');
    await shot('skip', 'arrived');
  },

  async far() {
    const r = await ev(async () => {
      const w = window.__woodland;
      w.debug.teleport(20, 48, 0); // out in the meadow, far from any stop
      await w.sim(0.2);
      w.arrived = null;
      w.ctx.transport.travelTo('interior').then((ok) => (w.arrived = ok));
      const phases = new Set();
      const t = await w.simUntil(() => {
        if (w.ctx.transport.trip) phases.add(w.ctx.transport.trip.phase);
        return w.arrived !== null;
      }, 60);
      return { t, p: w.p(), phases: [...phases] };
    });
    console.log('  ', JSON.stringify(r));
    check(r.phases.includes('fadeOut') && r.p.area === 'interior', 'far from a stop → fade to the station, then ride');
  },

  async markers() {
    await ev(async () => {
      const w = window.__woodland;
      const st = w.ctx.transport.stations.find((s) => s.areaId === 'plaza');
      w.debug.teleport(st.x + 2.2, st.z + 1.2, -2);
      await w.simUntil(() => w.ctx.transport.stations.every((s) => s.state === 'home'), 40);
      await w.sim(1.2);
    });
    const r = await ev(() => ({ nearest: window.__woodland.ctx.interactions.nearest?.label ?? null }));
    check(r.nearest && /Schneckenpost/.test(r.nearest), `proximity prompt near the plaza stop (${r.nearest})`);
    await ev(() => window.__woodland.debug.view({ position: [-1, 6, 12], target: [-4, 1, 4] }));
    await shot('markers', 'near-stop');
    await ev(() => window.__woodland.debug.free());
  },

  async focus() {
    const r = await ev(async () => {
      const w = window.__woodland;
      const h = w.ctx.interactions.hotspots.find((x) => x.entryId) ?? w.ctx.interactions.hotspots[0];
      const c = h.center();
      w.debug.teleport(c.x + 5, c.z + 5, 0);
      await w.sim(0.3);
      w.ctx.cameraRig.focus(h.object, h.focus ?? {});
      await w.sim(2.5);
      return { label: h.label, mode: w.ctx.cameraRig.mode };
    });
    console.log('  ', JSON.stringify(r));
    await shot('focus', 'framed');
    await ev(async () => {
      const w = window.__woodland;
      w.ctx.cameraRig.release();
      await w.sim(2.5);
    });
    await shot('focus', 'released');
    check(r.mode === 'focus', 'camera focus mode');
  },

  async input() {
    // real pointer input: click → walk, drag → orbit (no walk), hover → tooltip & cursor
    await ev(async () => {
      const w = window.__woodland;
      w.debug.teleport(0, 6, Math.PI);
      w.ctx.cameraRig.snap();
      await w.sim(0.5);
    });
    const tapAt = { x: Math.round(W * 0.5), y: Math.round(H * 0.32) };
    if (mobile) await page.touchscreen.tap(tapAt.x, tapAt.y);
    else await page.mouse.click(tapAt.x, tapAt.y);
    const walk = await ev(async () => {
      const w = window.__woodland;
      const routed = !!w.ctx.player.route;
      await w.sim(1);
      return { routed, p: w.p(), speed: w.ctx.player.speed };
    });
    console.log('   click/tap →', JSON.stringify(walk));
    check(walk.routed && walk.p.z < 5, `${mobile ? 'tap' : 'click'} on the ground walks there`);
    await ev(async () => {
      const w = window.__woodland;
      w.ctx.player.stop();
      await w.sim(0.6);
      w.yaw0 = w.ctx.cameraRig.yaw;
    });
    if (mobile) {
      const cdp = await page.context().newCDPSession(page);
      const pts = (x) => [{ x, y: H * 0.5 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(W * 0.3) });
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(W * 0.3 + i * 18) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      if (process.env.DBG) {
        page.on('console', (m) => m.text().startsWith('dbg') && console.log('   ', m.text()));
        await ev(() => {
          const g = window.__woodland.ctx.interactions.gestures;
          for (const t of ['tap', 'dragstart', 'dragend', 'hold', 'holdend']) g.on(t, () => console.log('dbg gesture', t, g.mode));
          const c = window.__woodland.ctx.engine.renderer.domElement;
          for (const t of ['pointerdown', 'pointerup', 'lostpointercapture', 'pointercancel']) c.addEventListener(t, (e) => console.log('dbg evt', t, e.pointerId, e.button, e.buttons));
        });
      }
      await page.mouse.move(W * 0.3, H * 0.5);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(W * 0.3 + i * 30, H * 0.5 + i * 2);
      await page.mouse.up();
    }
    const drag = await ev(async () => {
      const w = window.__woodland;
      await w.sim(0.5);
      return { dyaw: +(w.ctx.cameraRig.yaw - w.yaw0).toFixed(3), routed: !!w.ctx.player.route };
    });
    console.log('   drag →', JSON.stringify(drag));
    check(Math.abs(drag.dyaw) > 0.3 && !drag.routed, 'dragging orbits the camera and does not walk');
    if (!mobile) {
      const st = await ev(async () => {
        const w = window.__woodland;
        const s = w.ctx.transport.stationFor('plaza');
        const v = s.snail.group.position.clone();
        v.y += 0.8;
        v.project(w.ctx.camera);
        return { x: Math.round(((v.x + 1) / 2) * innerWidth), y: Math.round(((1 - v.y) / 2) * innerHeight) };
      });
      await page.mouse.move(st.x - 3, st.y);
      await page.mouse.move(st.x, st.y);
      const hov = await ev(async () => {
        const w = window.__woodland;
        await w.sim(0.3);
        return { hovered: w.ctx.interactions.hovered?.label ?? null, cursor: w.ctx.engine.renderer.domElement.style.cursor };
      });
      console.log('   hover →', JSON.stringify(hov));
      check(hov.hovered && hov.cursor === 'pointer', 'hovering a hotspot shows the pointer cursor');
      await showUI(true);
      await shot('input', 'hover');
      await showUI(false);
      await page.mouse.move(5, 5);
    }
  },

  async perf() {
    // CPU time of one simulated frame (all updaters, no rendering) in typical states
    const r = await ev(async () => {
      const w = window.__woodland;
      const { engine } = w.ctx;
      const measure = (frames = 180) => {
        const t0 = performance.now();
        for (let i = 0; i < frames; i++) engine.step(1 / 60, false);
        return +((performance.now() - t0) / frames).toFixed(3);
      };
      w.debug.teleport(0, 8, Math.PI);
      await w.sim(0.3);
      const idle = measure();
      w.ctx.player.moveTo(25, -30);
      const walking = measure();
      w.debug.teleport(-2, 6, 0);
      await w.sim(0.2);
      w.ctx.transport.travelTo('woodworking');
      await w.simUntil(() => w.ctx.transport.trip?.phase === 'ride', 20);
      const riding = measure(120);
      await w.simUntil(() => !w.ctx.transport.busy, 40);
      const nav = w.ctx.player.nav;
      const t0 = performance.now();
      for (let i = 0; i < 20; i++) nav.findPath(-50 + i, 30, 45, -20 + i);
      const astar = +((performance.now() - t0) / 20).toFixed(2);
      return { msPerFrame: { idle, walking, riding }, astarMs: astar, navBuildMs: +nav.buildMs.toFixed(1) };
    });
    console.log('  ', JSON.stringify(r));
    check(r.msPerFrame.walking < 8, 'update loop stays cheap while walking');
  },

  async panel() {
    const r = await ev(async () => {
      const w = window.__woodland;
      const h = w.ctx.interactions.hotspots.find((x) => x.entryId === 'dining-table') ?? w.ctx.interactions.hotspots.find((x) => x.entryId);
      w.debug.teleport(0, -16, Math.PI);
      await w.sim(0.5);
      w.ctx.interactions.activate(h, { source: 'pointer' });
      await w.sim(3);
      return { label: h.label, open: w.ctx.ui.isPanelOpen, mode: w.ctx.cameraRig.mode, p: w.p(), walking: !!w.ctx.player.route };
    });
    console.log('  ', JSON.stringify(r));
    await showUI(true);
    await page.waitForTimeout(600); // CSS slide-in
    await shot('panel', 'open');
    await ev(async () => {
      const w = window.__woodland;
      w.ctx.ui.closePanel();
      await w.sim(2.5);
    });
    await page.waitForTimeout(500);
    await shot('panel', 'closed');
    await showUI(false);
    check(r.open && r.mode === 'focus', 'activating a hotspot opens its panel and frames it');
  },

  async juice() {
    // footstep dust on the path
    await ev(async () => {
      const w = window.__woodland;
      const path = w.ctx.ground.pathPolylines.find((q) => q.id === 'bikes').pts;
      const a = path[2], b = path[Math.floor(path.length * 0.6)];
      w.debug.teleport(a.x, a.z, Math.atan2(b.x - a.x, b.z - a.z));
      w.ctx.player.moveTo(b.x, b.z, { run: true });
      await w.sim(1.1);
      const p = w.ctx.player.position;
      const f = w.ctx.player.facing;
      w.debug.view({ position: [p.x + Math.sin(f) * 3 + Math.cos(f) * 3.5, p.y + 1.8, p.z + Math.cos(f) * 3 - Math.sin(f) * 3.5], target: [p.x - Math.sin(f) * 0.6, p.y + 0.4, p.z - Math.cos(f) * 0.6] });
    });
    await shot('juice', 'dust');
    // hop onto a snail
    await ev(async () => {
      const w = window.__woodland;
      w.debug.free();
      const st = w.ctx.transport.stationFor('plaza');
      w.debug.teleport(st.x + 1.5, st.z - 0.6, -1.5);
      await w.sim(0.3);
      w.ctx.player.mount(st.snail.seat);
      await w.sim(0.2);
      w.debug.view({ position: [st.x + 4, 2.6, st.z + 3.5], target: [st.x, 1.2, st.z] });
    });
    await shot('juice', 'hop');
    await ev(async () => {
      const w = window.__woodland;
      await w.sim(0.4);
      w.ctx.player.mount(null);
      await w.sim(0.8);
      w.debug.free();
      // idle: wait for a fidget, then force a wave
      w.ctx.player.wave();
      await w.sim(1.2);
      const p = w.ctx.player.position;
      w.debug.view({ position: [p.x + 1.2, p.y + 1.6, p.z + 3.4], target: [p.x, p.y + 0.7, p.z] });
    });
    await shot('juice', 'wave');
    await ev(() => window.__woodland.debug.free());
  },

  async intro() {
    await ev(() => {
      const w = window.__woodland;
      w.debug.teleport(0, 8, Math.PI);
      w.ctx.cameraRig.prepareIntro();
    });
    await ev(() => window.__woodland.sim(0.5));
    await shot('intro', '0-parked');
    await ev(() => {
      const w = window.__woodland;
      w.introDone = false;
      w.ctx.cameraRig.playIntro().then(() => (w.introDone = true));
    });
    await ev(() => window.__woodland.sim(1.4));
    await shot('intro', '1-gliding');
    await ev(() => window.__woodland.sim(1.2));
    await shot('intro', '2-gliding');
    const t = await ev(() => window.__woodland.simUntil(() => window.__woodland.introDone, 5));
    await shot('intro', '3-done');
    check(t < 3, 'intro finishes (~3.6 s)');
  },

  async terrain() {
    // camera must never dip into the rim hills
    const r = await ev(async () => {
      const w = window.__woodland;
      w.debug.teleport(-8, -58, 0);
      w.ctx.cameraRig.yaw = Math.PI; // look back from beyond the rim
      w.ctx.cameraRig.pitch = 0.25;
      w.ctx.cameraRig.distance = 24;
      w.ctx.cameraRig.snap();
      await w.sim(1.5);
      const c = w.ctx.camera.position;
      return { camY: +c.y.toFixed(2), ground: +w.debug.groundHeight(c.x, c.z).toFixed(2) };
    });
    console.log('  ', JSON.stringify(r));
    check(r.camY > r.ground + 0.8, 'camera stays above the hills');
    await shot('terrain', 'rim');
    await ev(async () => {
      const w = window.__woodland;
      w.debug.teleport(30, 48, 0); // forest edge in the south-east
      w.ctx.cameraRig.yaw = 0.6;
      w.ctx.cameraRig.pitch = 0.45;
      w.ctx.cameraRig.distance = 20;
      w.ctx.cameraRig.snap();
      await w.sim(1.5);
    });
    await shot('terrain', 'edge');
    await ev(() => {
      const w = window.__woodland;
      w.ctx.cameraRig.yaw = 0;
      w.ctx.cameraRig.pitch = 0.62;
      w.ctx.cameraRig.distance = 17;
    });
  },
};

const t0 = Date.now();
for (const [name, fn] of Object.entries(scenarios)) {
  if (only && !only.includes(name)) continue;
  console.log(`\n▶ ${name}`);
  const s = Date.now();
  try {
    await fn();
  } catch (err) {
    failed++;
    console.log(`  FAIL threw: ${err.stack || err.message}`);
  }
  console.log(`  (${((Date.now() - s) / 1000).toFixed(1)}s)`);
}
const stats = await ev(() => window.__woodland.debug.stats());
console.log('\n[stats]', JSON.stringify({ ...stats, build: undefined }));
if (problems.length) {
  console.log(`\n${problems.length} console problem(s):`);
  for (const p of [...new Set(problems)].slice(0, 40)) console.log('  ' + p);
}
console.log(`\n${failed ? `${failed} check(s) FAILED` : 'all checks passed'} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
await browser.close();
await server.close();
process.exit(failed || problems.some((p) => !p.startsWith('[console.warning]')) ? 1 : 0);
