import { defineConfig } from 'vite';

// `base: './'` keeps asset URLs relative so the build works on GitHub Pages
// project sites (/portfolio/) as well as on a custom domain.
export default defineConfig({
  base: './',
  server: { host: true },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
});
