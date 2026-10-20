/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'

/**
 * Same-origin proxy to qBittorrent, mirroring the production nginx setup:
 * /qbt/api/v2/... → $QBITTORRENT_URL/api/v2/...
 * Origin and Referer are rewritten to the target so qBittorrent's CSRF check passes.
 */
function qbittorrentProxy(target: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/qbt/, ''),
    headers: { Origin: target, Referer: target },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxy: Record<string, ProxyOptions> = {}
  if (env.QBITTORRENT_URL) proxy['/qbt'] = qbittorrentProxy(env.QBITTORRENT_URL.replace(/\/+$/, ''))

  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
    },
  }
})
