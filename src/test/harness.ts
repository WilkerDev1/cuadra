// Arnés de pruebas (ARCHITECTURE.md 3.1, 4): node:sqlite ':memory:' + migrate() + reloj fijo + ids
// deterministas. Todas las pruebas de servicios del núcleo usan createTestCuadra().
import { createCuadra, type Cuadra } from '../core';
import { FixedClock } from '../core/dates';
import { SeqIdGen } from '../core/ids';
import type { SqlDriver } from '../core/ports';
import type { IsoDate } from '../core/types';
import { migrate } from '../data/migrate';
import { openNodeDriver } from '../data/node/nodeDriver';

export { FixedClock } from '../core/dates';
export { SeqIdGen } from '../core/ids';

/** Instante fijo de las pruebas: 2026-06-15 al mediodía UTC (08:00 en Santo Domingo, mismo día local). */
export const TEST_NOW = '2026-06-15T12:00:00Z';
export const TEST_TODAY: IsoDate = '2026-06-15';

export interface TestCuadra {
  cuadra: Cuadra;
  driver: SqlDriver;
  clock: FixedClock;
  ids: SeqIdGen;
}

export async function createTestCuadra(opts: { today?: IsoDate; seed?: number } = {}): Promise<TestCuadra> {
  const clock = new FixedClock(TEST_NOW);
  if (opts.today !== undefined) clock.setToday(opts.today);
  const ids = new SeqIdGen({ seed: opts.seed ?? 1, clock });
  const driver = await openNodeDriver({ path: ':memory:' });
  try {
    const { to } = await migrate(driver, { now: () => clock.now() });
    // PBKDF2 con pocas iteraciones: las pruebas de contraseña y respaldos cifrados van rápidas.
    const cuadra = createCuadra({ driver, clock, ids, locale: 'es-DO', schemaVersion: to, pbkdf2Iterations: 1_000 });
    return { cuadra, driver, clock, ids };
  } catch (error) {
    await driver.close();
    throw error;
  }
}
