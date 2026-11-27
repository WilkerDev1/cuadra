import { describe, expect, it } from 'vitest';
import { buildDictionary } from './es/index';
import { dictionary } from './es/index';
import { interpolate, scoped, t } from './index';

describe('diccionario', () => {
  it('junta los archivos por espacio de nombres', () => {
    expect(dictionary['common.appName']).toBe('Cuadra');
    expect(dictionary['errors.not_found']).toBeDefined();
    expect(dictionary['ui.gallery.title']).toBeDefined();
  });
  it('acepta claves sin prefijo y objetos anidados', () => {
    const d = buildDictionary({
      './capture.ts': { default: { save: 'Guardar', nested: { deep: 'Hondo' }, 'capture.in': 'Entrada' } },
      './errors.ts': { dictionary: { 'errors.not_found': 'No existe' } },
    });
    expect(d).toEqual({
      'capture.save': 'Guardar',
      'capture.nested.deep': 'Hondo',
      'capture.in': 'Entrada',
      'errors.not_found': 'No existe',
    });
  });
});

describe('t()', () => {
  it('interpola parámetros', () => {
    expect(interpolate('Mov {seq} de {name}', { seq: 12, name: 'Caja' })).toBe('Mov 12 de Caja');
    expect(interpolate('Sin {falta}', { otro: 1 })).toBe('Sin {falta}');
  });
  it('plural simple', () => {
    const tpl = '{n, plural, one {# movimiento} other {# movimientos}}';
    expect(interpolate(tpl, { n: 1 })).toBe('1 movimiento');
    expect(interpolate(tpl, { n: 3 })).toBe('3 movimientos');
    expect(interpolate(tpl, { n: 1200 })).toBe('1,200 movimientos');
    expect(interpolate('Hay {n, plural, =0 {nada} one {uno} other {#}} aquí', { n: 0 })).toBe('Hay nada aquí');
  });
  it('plural dentro de una clave real', () => {
    expect(t('common.status.migrations', { n: 0 })).toBe('Sin migraciones nuevas');
    expect(t('common.status.migrations', { n: 1 })).toBe('1 migración aplicada');
    expect(t('common.status.migrations', { n: 2 })).toBe('2 migraciones aplicadas');
  });
  it('clave inexistente se ve en dev', () => {
    expect(t('no.existe')).toBe('⟦no.existe⟧');
  });
  it('scoped prueba con prefijo y luego sin él', () => {
    expect(scoped('ui')('gallery.title')).toBe('Sistema de diseño');
    expect(scoped('ui')('common.appName')).toBe('Cuadra');
  });
});
