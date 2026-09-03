import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built site works from any host root (Render, subpaths, file servers)
export default defineConfig({
  plugins: [react()],
  base: './',
  test: {
    environment: 'jsdom',
    setupFiles: './src/tests/setup.js',
    globals: true,
    // broodiinnox-api is a separate Next.js project with its own node:test
    // runner — never let this app's vitest scan into it.
    exclude: ['**/node_modules/**', '**/dist/**', 'broodiinnox-api/**'],
  },
});
