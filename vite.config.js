/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const publicBase = process.env.GITHUB_ACTIONS ? '/vsl-stats-lab/' : '/'

export default defineConfig({
  base: publicBase,
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
  test: { environment: 'jsdom', globals: true, setupFiles: './src/test/setup.js' },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: [],
      manifest: {
        name: 'VSL Stats Lab', short_name: 'Stats Lab',
        description: 'Тестовый локальный учёт статистики волейбольного матча',
        theme_color: '#09111f', background_color: '#09111f',
        display: 'standalone', orientation: 'any', scope: publicBase, start_url: publicBase,
      },
      workbox: { navigateFallback: `${publicBase}index.html`, cleanupOutdatedCaches: true },
    }),
  ],
})
