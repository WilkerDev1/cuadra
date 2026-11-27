import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['src/test/setup.ts'],
    // Las pruebas de rendimiento (*.perf.test.ts) miden tiempo de reloj: corren en su propio grupo, DESPUÉS
    // del resto y sin otras suites en paralelo, para que la carga de la máquina no falsee la medida.
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'], exclude: ['src/**/*.perf.test.ts'] } },
      { extends: true, test: { name: 'perf', include: ['src/**/*.perf.test.ts'], sequence: { groupOrder: 1 } } },
    ],
  },
});
