import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Cuadra',
        short_name: 'Cuadra',
        description:
          'Libreta financiera para tu negocio: anota lo que entra y lo que sale, y cuadra tus cuentas sin enredos.',
        lang: 'es',
        dir: 'ltr',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        id: './',
        categories: ['finance', 'business', 'productivity'],
        theme_color: '#f4f7ef',
        background_color: '#f4f7ef',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          {
            name: 'Anotar entrada',
            short_name: 'Entrada',
            description: 'Anotar dinero que entra',
            url: './#/atajo/entrada',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Anotar salida',
            short_name: 'Salida',
            description: 'Anotar dinero que sale',
            url: './#/atajo/salida',
            icons: [{ src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm,json,webmanifest}'],
        // sqlite-wasm emite su worker1 y el proxy del VFS "opfs"; Cuadra usa su propio worker con
        // opfs-sahpool, así que no hacen falta sin conexión.
        globIgnores: ['**/sqlite3-worker1-*.js', '**/sqlite3-opfs-async-proxy-*.js'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  build: { target: 'es2023', sourcemap: true },
  server: { port: 5173 },
});
