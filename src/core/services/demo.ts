// Datos de ejemplo (ARCHITECTURE.md 3.5, 6). El generador vive en src/core/demo/ (dueño: 2D); este es el
// servicio de la fachada. Stub de la Oleada 1.
import { notImplemented } from '../errors';
import type { Mutation, Workspace } from '../types';
import type { CoreDeps } from '../uow';

export type DemoProfileId = 'colmado' | 'despacho';

export interface DemoService {
  profiles(): Array<{ id: DemoProfileId; name: string; description: string }>;
  /** Crea un espacio nuevo is_demo=1 con ~14 meses que terminan en clock.today(). */
  seed(profile: DemoProfileId, opts?: { seed?: number; months?: number }): Promise<Mutation<Workspace>>;
}

export function createDemoService(_deps: CoreDeps): DemoService {
  return {
    profiles: () => notImplemented('demo.profiles'),
    seed: async () => notImplemented('demo.seed'),
  };
}
