import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vitest/config';

// A build id lets host and friends detect mismatched versions after a redeploy.
const buildId = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? process.env.BUILD_ID ?? 'dev';
// `npm run dev:lan` serves over HTTPS so phones on your Wi-Fi get a secure context
// (needed for WebRTC encryption, gamepads, wake lock and fullscreen).
const https = process.env.HTTPS === '1';

export default defineConfig({
  base: './',
  plugins: https ? [basicSsl()] : [],
  define: {
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId),
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: { host: true },
  preview: { host: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
