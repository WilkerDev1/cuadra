import { defineConfig, devices } from '@playwright/test';

// Las pruebas E2E llegan en la Oleada 4 (carpeta e2e/).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173' },
  projects: [
    { name: 'movil', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 } } },
    { name: 'escritorio', use: { viewport: { width: 1440, height: 900 } } },
  ],
  webServer: { command: 'pnpm build && pnpm preview --port 4173', url: 'http://localhost:4173', reuseExistingServer: true },
});
