import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Built into the website as public/leandoku by the deploy workflow.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: process.env.LEANDOKU_OUT_DIR ?? 'dist', emptyOutDir: true },
  server: {
    proxy: { '/engine': { target: 'http://localhost:8787', rewrite: (p) => p.replace(/^\/engine/, '') } },
  },
});
