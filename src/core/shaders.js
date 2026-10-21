// ─────────────────────────────────────────────────────────────────────────────
// Waiting for shader programs without freezing the page (boot: main.js warm-up,
// textures/bakery.js before the bake batch).
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Resolve once every program in `programs` (three's WebGLProgram objects, e.g.
 * renderer.info.programs) is linked, reporting progress 0…1 as they finish.
 * With KHR_parallel_shader_compile the browser links in the background and
 * readiness is polled (giving up after `timeoutMs`: the first draw then waits
 * for what is left). Without it each link is waited for in turn — the first draw
 * would wait for them anyway — yielding every ~100 ms so the loader keeps painting.
 */
export async function waitForPrograms(renderer, programs, onProgress = () => {}, { timeoutMs = 60000 } = {}) {
  const n = programs.length || 1;
  const gl = renderer.getContext();
  if (renderer.extensions.has('KHR_parallel_shader_compile')) {
    let waiting = programs;
    const giveUp = performance.now() + timeoutMs;
    while (waiting.length && performance.now() < giveUp) {
      waiting = waiting.filter((p) => !p.isReady());
      onProgress(1 - waiting.length / n);
      if (waiting.length) await sleep(16);
    }
    return;
  }
  let last = performance.now();
  for (let i = 0; i < programs.length; i++) {
    gl.getProgramParameter(programs[i].program, gl.LINK_STATUS);
    if (performance.now() - last > 100) {
      onProgress((i + 1) / n);
      await sleep(0);
      last = performance.now();
    }
  }
  onProgress(1);
}
