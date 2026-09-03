/** @type {import('next').NextConfig} */
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('.', import.meta.url));

const nextConfig = {
  // this API lives inside a repo that ALSO has a Vite app — stop Next from
  // tracing the parent workspace's lockfiles/node_modules
  outputFileTracingRoot: dir,
  // mqtt and pg are Node-only stateful clients — require them at runtime
  serverExternalPackages: ['mqtt', 'pg'],
};

export default nextConfig;
