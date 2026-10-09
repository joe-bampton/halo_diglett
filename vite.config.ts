import { execSync } from 'node:child_process';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vitest/config';

/** The commit being built, wherever it's built (plain git as a last resort). */
function commit(build: boolean): string | undefined {
  const env = process.env;
  const fromHost = env.VERCEL_GIT_COMMIT_SHA ?? env.CF_PAGES_COMMIT_SHA ?? env.GITHUB_SHA ?? env.COMMIT_REF ?? env.BUILD_ID;
  if (fromHost || !build) return fromHost;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || undefined;
  } catch {
    return undefined;
  }
}

export default defineConfig(({ command }) => {
  // A build id lets host and friends detect mismatched versions after a redeploy (Vercel, Cloudflare Pages, GitHub
  // Actions, Netlify or a local build). The dev server stays 'dev', which plays with anything.
  const buildId = commit(command === 'build')?.slice(0, 8) ?? 'dev';
  // `npm run dev:lan` serves over HTTPS so phones on your Wi-Fi get a secure context
  // (needed for WebRTC encryption, gamepads, wake lock and fullscreen).
  const https = process.env.HTTPS === '1';
  return {
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
  };
});
