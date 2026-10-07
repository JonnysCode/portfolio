import { defineConfig } from 'vite';

// `base: './'` keeps asset URLs relative so the build works on GitHub Pages
// project sites (/portfolio/) as well as on a custom domain.
export default defineConfig({
  base: './',
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
