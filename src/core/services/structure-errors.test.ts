// Códigos de error propios de estructura, ajustes y plantillas (alta del integrador en la Oleada 2).
import { afterEach, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import { isDomainError } from '../errors';

let h: TestCuadra | undefined;
afterEach(async () => {
  await h?.driver.close();
  h = undefined;
});

async function failure(call: () => unknown): Promise<unknown> {
  try {
    await call();
  } catch (e) {
    return e;
  }
  throw new Error('se esperaba un error');
}

describe('códigos de error de estructura', () => {
  it('nombre vacío → name_required en espacios, cuentas, campos y vistas', async () => {
    h = await createTestCuadra();
    const c = h.cuadra;
    expect(isDomainError(await failure(() => c.workspaces.create({ name: '  ' })), 'name_required')).toBe(true);
    const ws = (await c.workspaces.create({ name: 'Taller' })).value;
    expect(isDomainError(await failure(() => c.accounts.create({ workspaceId: ws.id, name: '' })), 'name_required')).toBe(true);
    expect(isDomainError(await failure(() => c.fields.create({ workspaceId: ws.id, label: ' ', type: 'text' })), 'name_required')).toBe(true);
  });

  it('moneda inválida → invalid_currency', async () => {
    h = await createTestCuadra();
    const c = h.cuadra;
    const e1 = await failure(() => c.workspaces.create({ name: 'A', currency: { code: 'peso', minorDigits: 2 } }));
    expect(isDomainError(e1, 'invalid_currency')).toBe(true);
    const e2 = await failure(() => c.workspaces.create({ name: 'B', currency: { code: 'DOP', minorDigits: 1 as 2 } }));
    expect(isDomainError(e2, 'invalid_currency')).toBe(true);
  });

  it('ajuste desconocido o con valor inválido → invalid_setting', async () => {
    h = await createTestCuadra();
    const c = h.cuadra;
    expect(isDomainError(await failure(() => c.settings.get('nope' as 'theme')), 'invalid_setting')).toBe(true);
    expect(isDomainError(await failure(() => c.settings.set('theme', 'azul' as 'dark')), 'invalid_setting')).toBe(true);
  });

  it('fusionar opciones de campos distintos → merge_different_field', async () => {
    h = await createTestCuadra();
    const c = h.cuadra;
    const ws = (await c.workspaces.create({ name: 'Taller' })).value;
    const a = (await c.fields.create({ workspaceId: ws.id, label: 'Categoría', type: 'list', options: [{ label: 'Luz' }] })).value;
    const b = (await c.fields.create({ workspaceId: ws.id, label: 'Contacto', type: 'list', options: [{ label: 'Ana' }] })).value;
    const e = await failure(() => c.fields.mergeOptions(a.options[0]!.id, b.options[0]!.id));
    expect(isDomainError(e, 'merge_different_field')).toBe(true);
  });

  it('plantilla con forma inválida → template_invalid con las incidencias', async () => {
    h = await createTestCuadra();
    const e = await failure(() => h!.cuadra.templates.apply({ format: 'otra-cosa' } as never, { name: 'X' }));
    expect(isDomainError(e, 'template_invalid')).toBe(true);
    expect(((e as { details?: { issues?: unknown[] } }).details?.issues ?? []).length).toBeGreaterThan(0);
  });
});
