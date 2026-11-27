// Cada mensaje de historial que escribe el núcleo tiene texto en español, y los textos interpolan bien.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { interpolate } from './index';
import { dictionary } from './es/index';

const CORE = resolve(import.meta.dirname, '../core');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && !/\.(test|testkit|fixture)\.ts$/.test(name) ? [path] : [];
  });
}

describe('mensajes del historial', () => {
  it('cada clave audit.* que usa el núcleo existe en el diccionario', () => {
    const keys = new Set<string>();
    for (const file of sources(CORE)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/'(audit\.[a-z]+\.[a-zA-Z_]+|audit\.settings)'/g)) keys.add(m[1]!);
      // Claves armadas en transactions.ts: audit.{tx,transfer,opening}.{create,edit,void,restore}.
    }
    for (const entity of ['tx', 'transfer', 'opening']) {
      for (const verb of ['create', 'edit', 'void', 'restore']) keys.add(`audit.${entity}.${verb}`);
    }
    expect(keys.size).toBeGreaterThan(40);
    for (const key of keys) expect(dictionary[key], key).toBeTypeOf('string');
  });

  it('plurales y parámetros', () => {
    expect(interpolate(dictionary['audit.batch.void']!, { count: 3, label: 'Ventas del 10/06' })).toBe(
      'Se anuló el lote «Ventas del 10/06» (3 movimientos)',
    );
    expect(interpolate(dictionary['audit.option.merge']!, { movedCount: 1, sourceLabel: 'Luz', targetLabel: 'Electricidad' })).toBe(
      '«Luz» se fusionó con «Electricidad» (1 movimiento)',
    );
    expect(interpolate(dictionary['audit.tx.edit']!, { seq: 12, description: 'Agua' })).toBe('Se editó el n.º 12: Agua');
  });
});
