/**
 * Serve the built app the way the deployed static site does, and stay up, so a
 * probe can drive it with LIVE_BASE. Started in the background:
 *
 *   node _serve_dist.mjs
 *   LIVE_BASE=http://127.0.0.1:4321 node _sheet_matrix_check.mjs
 */
import { preview } from 'vite';

const server = await preview({ preview: { port: 4321, strictPort: true } });
console.log(`[serve] the built app is on ${server.resolvedUrls.local[0]}`);
