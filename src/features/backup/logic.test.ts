import { describe, expect, it } from 'vitest';
import type { TemplateFile } from '../../core';
import { createTestCuadra } from '../../test/harness';
import {
  backupAge,
  calendarDaysBetween,
  encryptedBackupName,
  lastVerifiedAfterRestore,
  openBackupText,
  sealBackup,
  formatBytes,
  includeCount,
  localIsoDate,
  normalizeInclude,
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

describe('respaldo cifrado con la contraseña de la sesión', () => {
  async function withPassword(password = 'clave-de-ana-123') {
    const t = await createTestCuadra();
    const { cuadra } = t;
    await cuadra.workspaces.create({ name: 'Colmado La Esquina' });
    await cuadra.auth.setup({ profileName: 'Ana', password });
    return t;
  }

  it('cifra con la sesión, sin el nombre del espacio en el archivo, y se vuelve a abrir sin pedir contraseña', async () => {
    const { cuadra } = await withPassword();
    const [ws] = await cuadra.workspaces.list();
    const out = await cuadra.backup.export({ scope: 'workspace', workspaceId: ws!.id });
    expect(out.suggestedName).toContain('colmado');
    const sealed = await sealBackup(out, cuadra.auth, '2026-06-15');
    expect(sealed.encrypted).toBe(true);
    expect(sealed.name).toBe('cuadra-respaldo-2026-06-15.cuadra.json');
    expect(sealed.text).not.toContain('Colmado');
    expect(JSON.parse(sealed.text)).toMatchObject({ format: 'cuadra-encrypted' });
    expect(sealed.bytes).toBe(new TextEncoder().encode(sealed.text).length);

    const opened = await openBackupText(sealed.text, cuadra.auth);
    expect(opened).toMatchObject({ kind: 'open', encrypted: true });
    if (opened.kind !== 'open') return;
    const info = await cuadra.backup.inspect(opened.text);
    expect(info.ok).toBe(true);
    expect(info.workspaces.map((w) => w.name)).toEqual(['Colmado La Esquina']);
  });

  it('sin sesión con la que cifrar sale tal cual, en claro', async () => {
    const { cuadra } = await createTestCuadra();
    const out = await cuadra.backup.export({ scope: 'all' });
    expect(await sealBackup(out, null, '2026-06-15')).toEqual({ name: out.suggestedName, text: out.text, bytes: out.bytes, encrypted: false });
  });

  it('un respaldo hecho con otra contraseña pide la contraseña; uno en claro se abre tal cual', async () => {
    const a = await withPassword('la-de-antes-123');
    const old = await sealBackup(await a.cuadra.backup.export({ scope: 'all' }), a.cuadra.auth, '2026-06-15');
    const b = await withPassword('la-de-ahora-456');
    expect(await openBackupText(old.text, b.cuadra.auth)).toEqual({ kind: 'needsPassword', triedSession: true });
    expect(await openBackupText(old.text, null)).toEqual({ kind: 'needsPassword', triedSession: false });
    const info = await b.cuadra.backup.inspect(old.text, { password: 'la-de-antes-123' });
    expect(info.ok).toBe(true);
    const plain = await b.cuadra.backup.export({ scope: 'all' });
    expect(await openBackupText(plain.text, b.cuadra.auth)).toEqual({ kind: 'open', text: plain.text, encrypted: false });
    expect(await openBackupText('no es json', b.cuadra.auth)).toEqual({ kind: 'open', text: 'no es json', encrypted: false });
  });

  it('el nombre genérico conserva la fecha del núcleo', () => {
    expect(encryptedBackupName('cuadra-colmado-la-esquina-2026-11-27.cuadra.json', '2000-01-01')).toBe('cuadra-respaldo-2026-11-27.cuadra.json');
    expect(encryptedBackupName('raro.json', '2026-11-27')).toBe('cuadra-respaldo-2026-11-27.cuadra.json');
  });
});

describe('lastVerifiedAfterRestore', () => {
  it('se queda la marca más reciente entre la local y la fecha del archivo', () => {
    expect(lastVerifiedAfterRestore('2026-11-27T10:32:06.000Z', '2026-11-27T10:27:56.591Z')).toBe('2026-11-27T10:32:06.000Z');
    expect(lastVerifiedAfterRestore('2026-10-01T00:00:00.000Z', '2026-11-27T10:27:56.591Z')).toBe('2026-11-27T10:27:56.591Z');
    expect(lastVerifiedAfterRestore(null, '2026-11-27T10:27:56.591Z')).toBe('2026-11-27T10:27:56.591Z');
    expect(lastVerifiedAfterRestore('2026-10-01T00:00:00.000Z', 'roto')).toBe('2026-10-01T00:00:00.000Z');
    expect(lastVerifiedAfterRestore(null, 'roto')).toBeNull();
  });

  it('caso real: el núcleo ya conserva la marca local y la feature no la empeora', async () => {
    const { cuadra } = await createTestCuadra();
    await cuadra.backup.markVerified('2026-06-15T11:27:56.591Z');
    const file = await cuadra.backup.export({ scope: 'all' });
    await cuadra.backup.markVerified('2026-06-15T12:32:06.000Z');
    const local = await cuadra.settings.get('backup.lastVerifiedAt');
    const info = await cuadra.backup.inspect(file.text);
    await cuadra.backup.restoreAll(file.text, { confirm: true });
    expect(await cuadra.settings.get('backup.lastVerifiedAt')).toBe('2026-06-15T12:32:06.000Z');
    expect(lastVerifiedAfterRestore(local, info.createdAt)).toBe('2026-06-15T12:32:06.000Z');
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
