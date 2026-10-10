import { defineConfig } from 'vite';

// GitHub Pages serverer prosjektsider under /<repo-navn>/. Workflowen setter
// VITE_BASE ut fra repo-navnet, så base-stien alltid stemmer med Pages-URL-en.
// Lokalt (npm run dev) brukes '/'.
const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
