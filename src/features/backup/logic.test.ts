import { describe, expect, it } from 'vitest';
import type { TemplateFile } from '../../core';
import {
  backupAge,
  calendarDaysBetween,
  formatBytes,
  includeCount,
  localIsoDate,
  normalizeInclude,
  passwordProblem,
  pruneTemplate,
  viewsAvailable,
} from './logic';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h, 0, 0);

describe('backupAge', () => {
  const now = at(2026, 11, 27);
  it('sin respaldo es "nunca" y está vencido', () => {
    expect(backupAge(null, now, 30)).toEqual({ kind: 'never', overdue: true });
    expect(backupAge('no-es-fecha', now, 30)).toEqual({ kind: 'never', overdue: true });
  });
  it('el mismo día es "hoy" aunque pasen horas', () => {
    expect(backupAge(at(2026, 11, 27, 0).toISOString(), at(2026, 11, 27, 23), 30)).toMatchObject({ kind: 'today', overdue: false });
  });
  it('cuenta días de calendario, no 24 horas', () => {
    expect(backupAge(at(2026, 11, 26, 23).toISOString(), at(2026, 11, 27, 1), 30)).toMatchObject({ kind: 'days', n: 1 });
    expect(calendarDaysBetween(at(2026, 11, 24), at(2026, 11, 27))).toBe(3);
  });
  it('días, semanas y meses', () => {
    expect(backupAge(at(2026, 11, 24).toISOString(), now, 30)).toMatchObject({ kind: 'days', n: 3, overdue: false });
    expect(backupAge(at(2026, 11, 6).toISOString(), now, 30)).toMatchObject({ kind: 'weeks', n: 3, days: 21 });
    expect(backupAge(at(2026, 8, 1).toISOString(), now, 30)).toMatchObject({ kind: 'months', n: 3 });
  });
  it('vence al llegar al plazo del recordatorio', () => {
    expect(backupAge(at(2026, 10, 28).toISOString(), now, 30)).toMatchObject({ days: 30, overdue: true });
    expect(backupAge(at(2026, 10, 29).toISOString(), now, 30)).toMatchObject({ days: 29, overdue: false });
    expect(backupAge(at(2026, 11, 20).toISOString(), now, 7)).toMatchObject({ overdue: true });
  });
  it('un respaldo "del futuro" cuenta como hoy', () => {
    expect(backupAge(at(2026, 12, 5).toISOString(), now, 30)).toMatchObject({ kind: 'today' });
  });
});

describe('localIsoDate', () => {
  it('usa la fecha local', () => {
    expect(localIsoDate(at(2026, 11, 20, 9).toISOString())).toBe('2026-11-20');
    expect(localIsoDate('x')).toBeNull();
  });
});

describe('formatBytes', () => {
  it('escala la unidad y usa el separador del locale', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1_258_291)).toBe('1.2 MB');
    expect(formatBytes(1_258_291, 'es-ES')).toBe('1,2 MB');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('passwordProblem', () => {
  it('exige 8 caracteres y que coincidan al enviar', () => {
    expect(passwordProblem('corta', 'corta', { checkRepeat: true })).toBe('tooShort');
    expect(passwordProblem('suficiente', 'distinta', { checkRepeat: true })).toBe('mismatch');
    expect(passwordProblem('suficiente', 'distinta', { checkRepeat: false })).toBeNull();
    expect(passwordProblem('suficiente', 'suficiente', { checkRepeat: true })).toBeNull();
  });
});

const FILE: TemplateFile = {
  format: 'cuadra-template',
  formatVersion: 1,
  id: 'mi',
  version: 1,
  name: 'Mi espacio',
  description: 'Algo',
  accounts: [{ key: 'caja', name: 'Caja', type: 'cash' }],
  fields: [{ key: 'categoria', label: 'Categoría', type: 'list', options: [{ key: 'a', label: 'A' }] }],
  views: [{ key: 'v', name: 'Todo', kind: 'filter', recipe: { kind: 'filter' } as never }],
};

describe('pruneTemplate', () => {
  it('las vistas dependen de cuentas y campos', () => {
    expect(viewsAvailable({ accounts: true, fields: true })).toBe(true);
    expect(viewsAvailable({ accounts: true, fields: false })).toBe(false);
    expect(normalizeInclude({ accounts: false, fields: true, views: true })).toEqual({ accounts: false, fields: true, views: false });
    expect(includeCount({ accounts: true, fields: false, views: true })).toBe(1);
  });
  it('quita lo no elegido y renombra', () => {
    const all = pruneTemplate(FILE, { accounts: true, fields: true, views: true }, { name: '  Otro ', description: ' Desc ' });
    expect(all.name).toBe('Otro');
    expect(all.description).toBe('Desc');
    expect(all.views).toHaveLength(1);
    const noFields = pruneTemplate(FILE, { accounts: true, fields: false, views: true }, { name: '', description: '' });
    expect(noFields.fields).toEqual([]);
    expect(noFields.views).toEqual([]);
    expect(noFields.name).toBe('Mi espacio');
    expect(noFields.accounts).toHaveLength(1);
  });
});
