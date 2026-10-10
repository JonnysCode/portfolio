import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';

/**
 * A production build still carrying placeholder content gets a loud reminder:
 * the example address hides the contact button and DRAFT copy is hidden, so
 * the journal pages ship nearly empty (see src/content/content.js).
 */
function contentReminder() {
  return {
    name: 'woodland-content-reminder',
    apply: 'build',
    buildStart() {
      let src = '';
      try {
        src = readFileSync(new URL('./src/content/content.js', import.meta.url), 'utf8');
      } catch {
        return;
      }
      const drafts = (src.match(/DRAFT/g) ?? []).length;
      const notes = [];
      if (/email:\s*'[^']*@example\./.test(src)) notes.push('profile.email is still a placeholder (@example.com): the contact page leads with your strongest link instead');
      if (drafts) notes.push(`${drafts} DRAFT placeholders: those texts are hidden in production`);
      if (notes.length) this.warn(`\n  ✏️  src/content/content.js needs your real content:\n  - ${notes.join('\n  - ')}\n`);
    },
  };
}

// `base: './'` keeps asset URLs relative so the build works on GitHub Pages
// project sites (/portfolio/) as well as on a custom domain.
export default defineConfig({
  base: './',
  plugins: [contentReminder()],
  server: { host: true },
  resolve: { dedupe: ['three'] },
  // World modules load lazily (dynamic import), so declare the three.js addons up
  // front: otherwise the dev optimiser discovers them late, re-bundles and can
  // end up with two copies of three ("Multiple instances of Three.js").
  optimizeDeps: {
    include: [
      'three',
      'three/addons/utils/BufferGeometryUtils.js',
      'three/addons/geometries/RoundedBoxGeometry.js',
      'three/addons/postprocessing/UnrealBloomPass.js',
      'three/addons/postprocessing/Pass.js',
    ],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
