import { describe, expect, it } from 'vitest';
import { createRestoreCopySink } from './index';
import { createMemoryByteStore, MAX_AUTO_SNAPSHOTS, SNAPSHOT_PREFIX } from './wasm/idbStore';

describe('copia previa a restaurar un respaldo', () => {
  it('guarda el archivo SQLite como copia automática y conserva solo las más recientes', async () => {
    const store = createMemoryByteStore();
    const sink = createRestoreCopySink({ store });
    expect(sink).toBeDefined();
    for (let i = 0; i < MAX_AUTO_SNAPSHOTS + 2; i += 1) {
      await sink!({ name: `copia-${i}.cuadra.json`, createdAt: `2026-06-1${i}T12:00:00.000Z`, bytes: new Uint8Array([i]) });
    }
    const keys = (await store.keys()).filter((k) => k.startsWith(SNAPSHOT_PREFIX)).sort();
    expect(keys).toHaveLength(MAX_AUTO_SNAPSHOTS);
    expect(keys.at(-1)).toContain('antes-de-restaurar:copia-4.cuadra.json');
    expect(await store.get(keys.at(-1)!)).toEqual(new Uint8Array([4]));
  });

  it('sin IndexedDB (Node) no hay destino y el núcleo guarda la copia dentro de la base', () => {
    expect(createRestoreCopySink()).toBeUndefined();
  });
});
