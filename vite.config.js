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
  },
});
