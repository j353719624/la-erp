import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig({
  plugins: [react(), VitePWA({ registerType: 'autoUpdate', manifest: false, workbox: { maximumFileSizeToCacheInBytes: 6 * 1024 * 1024, navigateFallbackDenylist: [/^\/api/, /^\/uploads/] } })],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/api': { target: process.env.ERP_BACKEND_URL || 'http://127.0.0.1:18886', changeOrigin: true }, '/uploads': { target: process.env.ERP_BACKEND_URL || 'http://127.0.0.1:18886', changeOrigin: true } } },
  build: { sourcemap: true, chunkSizeWarningLimit: 1500 }
});
