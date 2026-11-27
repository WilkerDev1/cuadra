import { defineConfig, devices } from '@playwright/test';

// Pruebas E2E de la Oleada 4 (carpeta e2e/). Corren contra la compilación de producción (`vite preview`), sin la
// fachada `window.__cuadra`: los datos de ejemplo se cargan con el botón de la bienvenida. El navegador lo abre
// `e2e/fixtures.ts` (perfil persistente nuevo por prueba, Chromium de la caché).
const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Cada prueba carga ~7 200 movimientos de ejemplo y algunas reescriben la base entera: más de 4 a la vez satura la
  // CPU y los tiempos se disparan (restaurar pasa de ~10 s a más de 90 s).
  workers: process.env['CI'] ? 2 : 4,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: 'node_modules/.cache/e2e-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'movil', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'escritorio', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
