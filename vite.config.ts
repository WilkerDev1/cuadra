import react from '@vitejs/plugin-react';
import { defineConfig, type HtmlTagDescriptor, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

/**
 * Política de contenido para la compilación: todo es local (SQLite WASM en un worker, fuentes empaquetadas, logos
 * `data:`), así que nada necesita red y una XSS no podría sacar datos del equipo. `wasm-unsafe-eval` es para compilar
 * sqlite3.wasm; `ipc:`/`ipc.localhost` para la cáscara Tauri. `frame-ancestors` no vale en <meta>: va en las
 * cabeceras del hosting. Solo en build: en desarrollo Vite inyecta scripts en línea (react-refresh).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self' ipc: http://ipc.localhost",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Arranque sin cascada: el worker de SQLite y su .wasm se piden desde el HTML, a la vez que el bloque principal, en
 * lugar de esperar a que este se ejecute y cree el worker. Y la CSP de arriba.
 */
function bootHints(): Plugin {
  let base = './';
  return {
    name: 'cuadra-boot-hints',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const tags: HtmlTagDescriptor[] = [
          { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
        ];
        const files = Object.keys(ctx.bundle ?? {});
        const wasm = files.find((f) => /(^|\/)sqlite3-[\w-]+\.wasm$/.test(f));
        const worker = files.find((f) => /(^|\/)db\.worker-[\w-]+\.js$/.test(f));
        if (wasm !== undefined) {
          tags.push({ tag: 'link', attrs: { rel: 'preload', href: base + wasm, as: 'fetch', type: 'application/wasm', crossorigin: '' }, injectTo: 'head' });
        }
        if (worker !== undefined) {
          tags.push({ tag: 'link', attrs: { rel: 'preload', href: base + worker, as: 'fetch', crossorigin: '' }, injectTo: 'head' });
        }
        return tags;
      },
    },
  };
}

export default defineConfig({
  base: './',
  // Versión de package.json para los respaldos (src/app/boot.ts → CuadraDeps.appVersion).
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version) },
  plugins: [
    react(),
    bootHints(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      // Los archivos de public/ ya entran por globPatterns: sin includeAssets ni los iconos del manifest repetidos.
      includeManifestIcons: false,
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
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wasm,json}'],
        // sqlite-wasm emite su worker1 y el proxy del VFS "opfs"; Cuadra usa su propio worker con
        // opfs-sahpool, así que no hacen falta sin conexión.
        // La fuente vietnamita nunca se descarga para texto en español (unicode-range).
        globIgnores: ['**/sqlite3-worker1-*.js', '**/sqlite3-opfs-async-proxy-*.js', '**/*vietnamese*'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
    // Se cargan con import() perezoso: sin esto, la primera lectura de un .xlsx en desarrollo da «504 Outdated Optimize Dep».
    include: ['read-excel-file/browser', 'read-excel-file/universal', 'write-excel-file/browser', 'write-excel-file/universal', 'papaparse'],
  },
  build: {
    target: 'es2023',
    sourcemap: true,
    rolldownOptions: {
      output: {
        // El bloque de entrada solo arranca (boot, loading); React y el núcleo van en bloques propios que se piden
        // en paralelo (modulepreload) y cambian poco entre versiones, así la caché los conserva. La app (router,
        // features, pantallas) ya va aparte por import() (src/app/shell/loadApp.ts).
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 20 },
            { name: 'core', test: /src[\\/]core[\\/]|node_modules[\\/]papaparse[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  server: { port: 5173 },
});
