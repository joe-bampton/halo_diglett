import { defineConfig } from 'vitest/config';

// A build id lets host and friends detect mismatched versions after a redeploy.
const buildId = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? process.env.BUILD_ID ?? 'dev';

export default defineConfig({
  base: './',
  define: {
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId),
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: { host: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
