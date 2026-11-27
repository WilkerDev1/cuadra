// Respaldo JSON versionado (ARCHITECTURE.md 3.7, pruebas 90–94). Los datos se siembran con SQL directo:
// el respaldo es un volcado de tablas y no depende de los servicios de movimientos ni de estructura.
import { afterEach, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../../test/harness';
import { encryptText } from '../crypto';
import { isDomainError } from '../errors';
import { createEventBus, type ChangeEvent } from '../events';
import type { Row, SqlExecutor } from '../ports';
import type { CoreDeps } from '../uow';
import { createAuditWriter } from './audit';
import {
  BACKUP_TABLES,
  computeChecksum,
  createBackupService,
  type AutoCopy,
  type BackupFile,
  type BackupService,
} from './backup';
import { upgradeBackup, type BackupUpgrader } from './backup-upgrades';
import { createAuthService } from './auth';

let h: TestCuadra | undefined;
afterEach(async () => {
  await h?.driver.close();
  h = undefined;
});

const T0 = '2026-06-01T10:00:00.000Z';

interface Seed {
  wsA: string;
  wsB: string;
  cash: string;
  bank: string;
  fCat: string;
  fPaid: string;
  oVentas: string;
  oLuz: string;
  oElectricidad: string;
  batch: string;
  transferGroup: string;
}

/** Siembra dos espacios con todo tipo de filas: saldo inicial, lote, transferencia, anulado, fusión… */
async function seed(tx: SqlExecutor): Promise<Seed> {
  const s: Seed = {
    wsA: '01900000-0000-7000-8000-00000000000a',
    wsB: '01900000-0000-7000-8000-00000000000b',
    cash: '01900000-0000-7000-8000-0000000000a1',
    bank: '01900000-0000-7000-8000-0000000000a2',
    fCat: '01900000-0000-7000-8000-0000000000f1',
    fPaid: '01900000-0000-7000-8000-0000000000f2',
    oVentas: '01900000-0000-7000-8000-0000000000c1',
    oLuz: '01900000-0000-7000-8000-0000000000c2',
    oElectricidad: '01900000-0000-7000-8000-0000000000c3',
    batch: '01900000-0000-7000-8000-0000000000b1',
    transferGroup: '01900000-0000-7000-8000-0000000000e1',
  };
  const ins = (sql: string, p: (string | number | null)[]) => tx.run(sql, p);
  await ins('INSERT INTO workspaces (id, name, owner_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
    s.wsA, 'Colmado La Esquina', 'Ana', T0, T0,
  ]);
  await ins('INSERT INTO workspaces (id, name, sort_order, created_at, updated_at) VALUES (?, ?, 1, ?, ?)', [
    s.wsB, 'Finanzas personales', T0, T0,
  ]);
  await ins('INSERT INTO accounts (id, workspace_id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
    s.cash, s.wsA, 'Caja', 'cash', T0, T0,
  ]);
  await ins('INSERT INTO accounts (id, workspace_id, name, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
    s.bank, s.wsA, 'Banco', 'bank', T0, T0,
  ]);
  const personal = '01900000-0000-7000-8000-0000000000b9';
  await ins('INSERT INTO accounts (id, workspace_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
    personal, s.wsB, 'Cartera', T0, T0,
  ]);
  await ins(
    'INSERT INTO fields (id, workspace_id, key, label, type, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [s.fCat, s.wsA, 'categoria', 'Categoría', 'list', 'category', T0, T0],
  );
  await ins(
    'INSERT INTO fields (id, workspace_id, key, label, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [s.fPaid, s.wsA, 'pagado', 'Pagado', 'bool', T0, T0],
  );
  await ins('INSERT INTO field_options (id, field_id, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
    s.oVentas, s.fCat, 'Ventas', T0, T0,
  ]);
  await ins('INSERT INTO field_options (id, field_id, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
    s.oElectricidad, s.fCat, 'Electricidad', T0, T0,
  ]);
  // "Luz" fusionada en "Electricidad": desactivada con merged_into_id (referencia a otra fila de la tabla).
  await ins(
    'INSERT INTO field_options (id, field_id, label, deactivated_at, merged_into_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [s.oLuz, s.fCat, 'Luz', T0, s.oElectricidad, T0, T0],
  );
  await ins(
    'INSERT INTO batches (id, workspace_id, account_id, source, label, control_total_minor, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [s.batch, s.wsA, s.cash, 'capture', 'Ventas del día', 300000, JSON.stringify({ rows: 2 }), T0],
  );

  let n = 0;
  const txId = () => `01900000-0000-7000-8000-${String(0xd00 + ++n).padStart(12, '0')}`;
  const addTx = async (t: {
    ws: string;
    account: string;
    kind: string;
    direction: string;
    amount: number;
    date: string;
    description: string;
    status?: 'active' | 'voided';
    batch?: string | null;
    group?: string | null;
  }) => {
    const id = txId();
    const r = await tx.get<{ seq: number }>(
      'UPDATE accounts SET next_seq = next_seq + 1 WHERE id = ? RETURNING next_seq - 1 AS seq',
      [t.account],
    );
    const voided = t.status === 'voided';
    await ins(
      `INSERT INTO transactions (id, workspace_id, account_id, seq, kind, direction, amount_minor, date, description,
         notes, search_text, status, void_reason, voided_at, batch_id, transfer_group_id, recorded_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, t.ws, t.account, r?.seq ?? 0, t.kind, t.direction, t.amount, t.date, t.description,
        t.description.toLowerCase(), voided ? 'voided' : 'active', voided ? 'error' : null, voided ? T0 : null,
        t.batch ?? null, t.group ?? null, T0, T0,
      ],
    );
    return id;
  };
  const opening = await addTx({ ws: s.wsA, account: s.cash, kind: 'opening', direction: 'in', amount: 500000, date: '2026-01-01', description: 'Saldo inicial' });
  const sale1 = await addTx({ ws: s.wsA, account: s.cash, kind: 'income', direction: 'in', amount: 150000, date: '2026-05-02', description: 'Venta', batch: s.batch });
  const sale2 = await addTx({ ws: s.wsA, account: s.cash, kind: 'income', direction: 'in', amount: 150000, date: '2026-05-02', description: 'Venta', batch: s.batch });
  const power = await addTx({ ws: s.wsA, account: s.cash, kind: 'expense', direction: 'out', amount: 4550, date: '2026-05-03', description: 'Factura de luz' });
  await addTx({ ws: s.wsA, account: s.cash, kind: 'transfer', direction: 'out', amount: 100000, date: '2026-05-04', description: 'Depósito', group: s.transferGroup });
  await addTx({ ws: s.wsA, account: s.bank, kind: 'transfer', direction: 'in', amount: 100000, date: '2026-05-04', description: 'Depósito', group: s.transferGroup });
  await addTx({ ws: s.wsA, account: s.cash, kind: 'expense', direction: 'out', amount: 999, date: '2026-05-05', description: 'Error de tecleo', status: 'voided' });
  await addTx({ ws: s.wsB, account: personal, kind: 'income', direction: 'in', amount: 2500000, date: '2026-05-30', description: 'Salario' });
  void opening;

  const tfv = 'INSERT INTO transaction_field_values (transaction_id, field_id, value_option_id, value_bool) VALUES (?, ?, ?, ?)';
  await ins(tfv, [sale1, s.fCat, s.oVentas, null]);
  await ins(tfv, [sale2, s.fCat, s.oVentas, null]);
  await ins(tfv, [power, s.fCat, s.oElectricidad, null]);
  await ins(tfv, [power, s.fPaid, null, 1]);

  await ins(
    'INSERT INTO saved_views (id, workspace_id, kind, name, recipe, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      '01900000-0000-7000-8000-0000000000f9', s.wsA, 'filter', 'Ventas en caja',
      JSON.stringify({ v: 1, kind: 'filter', filter: { accountIds: [s.cash], fields: [{ fieldId: s.fCat, op: 'any_of', optionIds: [s.oVentas] }] } }),
      T0, T0,
    ],
  );
  const action = '01900000-0000-7000-8000-0000000000aa';
  await ins(
    `INSERT INTO audit_log (id, workspace_id, at, action, entity_type, entity_id, account_id, batch_id, message, params, meta)
     VALUES (?, ?, ?, 'edit', 'transaction', ?, ?, NULL, 'audit.tx.edit', ?, NULL)`,
    [action, s.wsA, T0, power, s.cash, JSON.stringify({ accountId: s.cash })],
  );
  await ins(
    'INSERT INTO audit_log_changes (action_id, ord, entity_id, path, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)',
    [action, 0, power, `field:${s.fCat}`, JSON.stringify(s.oLuz), JSON.stringify(s.oElectricidad)],
  );
  await ins(
    `INSERT INTO audit_log (id, workspace_id, at, action, entity_type, entity_id, message)
     VALUES (?, NULL, ?, 'config', 'settings', NULL, 'audit.settings')`,
    ['01900000-0000-7000-8000-0000000000ab', T0],
  );
  const setting = 'INSERT INTO settings (scope_id, key, value, updated_at) VALUES (?, ?, ?, ?)';
  await ins(setting, ['', 'theme', JSON.stringify('dark'), T0]);
  await ins(setting, ['', 'sys.auth', JSON.stringify({ hash: 'secreto' }), T0]);
  await ins(setting, [s.wsA, 'capture.lastAccountId', JSON.stringify(s.cash), T0]);
  return s;
}

const PK: Record<string, string> = {
  workspaces: 'id',
  accounts: 'id',
  batches: 'id',
  fields: 'id',
  field_options: 'id',
  transactions: 'id',
  transaction_field_values: 'transaction_id, field_id',
  saved_views: 'id',
  audit_log: 'id',
  audit_log_changes: 'action_id, ord',
  settings: 'scope_id, key',
};

/** Todas las filas respaldables (sin claves sys.* ni la acción backup_restore que añade la restauración). */
async function dump(tx: SqlExecutor, opts: { skipRestoreAction?: boolean } = {}): Promise<Record<string, Row[]>> {
  const out: Record<string, Row[]> = {};
  for (const table of BACKUP_TABLES) {
    let where = '';
    if (table === 'settings') where = "WHERE key NOT LIKE 'sys.%'";
    if (table === 'audit_log' && opts.skipRestoreAction) where = "WHERE action <> 'backup_restore'";
    if (table === 'audit_log_changes' && opts.skipRestoreAction) {
      where = "WHERE action_id NOT IN (SELECT id FROM audit_log WHERE action = 'backup_restore')";
    }
    out[table] = await tx.all(`SELECT * FROM ${table} ${where} ORDER BY ${PK[table]}`);
  }
  return out;
}

function coreDeps(t: TestCuadra, events: ChangeEvent[] = []): CoreDeps {
  const bus = createEventBus();
  bus.subscribe((e) => events.push(e));
  return { driver: t.driver, clock: t.clock, ids: t.ids, events: bus, audit: createAuditWriter(t), locale: 'es-DO' };
}

async function setup(opts: { autoCopy?: (c: AutoCopy) => Promise<void> } = {}): Promise<{
  backup: BackupService;
  s: Seed;
  events: ChangeEvent[];
}> {
  h = await createTestCuadra();
  const s = await h.driver.transaction(seed);
  const events: ChangeEvent[] = [];
  const backup = createBackupService(coreDeps(h, events), {
    ...(opts.autoCopy ? { autoCopy: opts.autoCopy } : {}),
    encryption: { iterations: 1000 },
  });
  return { backup, s, events };
}

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    expect((e as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`se esperaba ${code}`);
}

/** Reescribe un respaldo en claro y recalcula su checksum (para simular archivos manipulados "bien"). */
async function rewrite(json: string, fn: (f: BackupFile) => void): Promise<string> {
  const file = JSON.parse(json) as BackupFile;
  fn(file);
  file.checksum = await computeChecksum(file.tables);
  return JSON.stringify(file);
}

describe('backup', () => {
  it('exportar y restaurar deja las mismas filas en todas las tablas respaldadas', async () => {
    const { backup, s } = await setup();
    const before = await h!.driver.transaction((tx) => dump(tx));
    const out = await backup.export({ scope: 'all' });
    expect(out.verified).toBe(true);
    expect(out.encrypted).toBe(false);
    expect(out.suggestedName).toBe('cuadra-2026-06-15.cuadra.json');
    expect(out.file.counts.transactions).toBe(8);
    expect(out.file.counts.settings).toBe(2); // sys.auth no sale del equipo
    expect(out.text).toContain('"format":"cuadra-backup"');
    expect(out.text).not.toContain('secreto');
    expect(out.bytes).toBe(new TextEncoder().encode(out.text).length);

    // Cambios posteriores: un espacio nuevo, un nombre cambiado y una opción nueva.
    await h!.driver.transaction(async (tx) => {
      await tx.run("INSERT INTO workspaces (id, name, created_at, updated_at) VALUES ('x', 'Otro', ?, ?)", [T0, T0]);
      await tx.run("UPDATE accounts SET name = 'Caja chica' WHERE id = ?", [s.cash]);
      await tx.run("INSERT INTO field_options (id, field_id, label, created_at, updated_at) VALUES ('o', ?, 'Nueva', ?, ?)", [s.fCat, T0, T0]);
    });

    const result = await backup.restoreAll(out.text, { confirm: true });
    expect(result).toMatchObject({ workspaces: 2, transactions: 8 });
    const after = await h!.driver.transaction((tx) => dump(tx, { skipRestoreAction: true }));
    expect(after).toEqual(before);
    // Las claves sys.* de la instalación se conservan; el modo mantenimiento no queda puesto.
    const sys = await h!.driver.all("SELECT key FROM settings WHERE key LIKE 'sys.%' ORDER BY key");
    expect(sys.map((r) => r['key'])).toContain('sys.auth');
    expect(sys.map((r) => r['key'])).not.toContain('sys.maintenance');
    const fk = await h!.driver.all('PRAGMA foreign_key_check');
    expect(fk).toEqual([]);
  });

  it('las claves auth.* no salen en el respaldo y restaurar conserva la contraseña del equipo', async () => {
    const { backup } = await setup();
    const auth = createAuthService(coreDeps(h!), { hashIterations: 1000, encryptionIterations: 1000 });
    await auth.setup({ profileName: 'Ana', password: 'clave-del-equipo' });
    const out = await backup.export({ scope: 'all' });
    const stored = await h!.driver.get<{ value: string }>("SELECT value FROM settings WHERE key = 'auth.passwordHash'");
    expect(stored).toBeDefined();
    expect(out.text).not.toContain(JSON.parse(stored!.value).hash ?? stored!.value);
    const exported = out.file.tables.settings;
    const keyAt = exported.columns.indexOf('key');
    expect(exported.rows.some((r) => String(r[keyAt]).startsWith('auth.'))).toBe(false);

    // Un archivo manipulado que sí trae auth.* tampoco las impone al restaurar.
    const forged = await rewrite(out.text, (f) => {
      const t = f.tables.settings;
      const row = t.columns.map((c) => (c === 'scope_id' ? '' : c === 'key' ? 'auth.passwordHash' : c === 'value' ? '"ajeno"' : T0));
      t.rows.push(row);
      f.counts.settings = t.rows.length;
    });
    await backup.restoreAll(forged, { confirm: true });
    const hash = await h!.driver.get<{ value: string }>("SELECT value FROM settings WHERE key = 'auth.passwordHash'");
    expect(hash?.value).not.toBe('"ajeno"');
    auth.lock();
    await auth.unlock('clave-del-equipo');
    expect((await auth.status()).locked).toBe(false);
  });

  it('checksum alterado → backup_checksum', async () => {
    const { backup } = await setup();
    const { text } = await backup.export({ scope: 'all' });
    const file = JSON.parse(text) as BackupFile;
    const tx = file.tables.transactions;
    const amountAt = tx.columns.indexOf('amount_minor');
    tx.rows[0]![amountAt] = 1; // alguien "corrige" un monto a mano
    const tampered = JSON.stringify(file);
    const inspection = await backup.inspect(tampered);
    expect(inspection.ok).toBe(false);
    expect(inspection.error).toBe('backup_checksum');
    await expectCode(backup.restoreAll(tampered, { confirm: true }), 'backup_checksum');
  });

  it('respaldo con schemaVersion mayor → backup_from_newer_version', async () => {
    const { backup } = await setup();
    const { text } = await backup.export({ scope: 'all' });
    const newer = await rewrite(text, (f) => {
      f.schemaVersion = 99;
    });
    const inspection = await backup.inspect(newer);
    expect(inspection).toMatchObject({ ok: false, error: 'backup_from_newer_version', schemaVersion: 99 });
    await expectCode(backup.restoreAll(newer, { confirm: true }), 'backup_from_newer_version');
    await expectCode(backup.importWorkspace(newer, 'cualquiera'), 'backup_from_newer_version');
  });

  it('importar un espacio suelto crea ids nuevos, conserva seq y no toca los existentes', async () => {
    const { backup, s, events } = await setup();
    const out = await backup.export({ scope: 'workspace', workspaceId: s.wsA });
    expect(out.file.scope).toBe('workspace');
    expect(out.file.workspaceIds).toEqual([s.wsA]);
    expect(out.file.counts.workspaces).toBe(1);
    expect(out.file.counts.transactions).toBe(7);
    expect(out.suggestedName).toBe('cuadra-colmado-la-esquina-2026-06-15.cuadra.json');

    const before = await h!.driver.transaction((tx) => dump(tx));
    const m = await backup.importWorkspace(out.text, s.wsA);
    const ws = m.value;
    expect(ws.id).not.toBe(s.wsA);
    expect(ws.name).toBe('Colmado La Esquina (2)');
    expect(m.auditActionId).not.toBeNull();
    expect(events.at(-1)).toMatchObject({ workspaceId: ws.id });

    // Lo previo, intacto (fila a fila).
    const after = await h!.driver.transaction((tx) => dump(tx));
    for (const table of BACKUP_TABLES) {
      for (const row of before[table]!) expect(after[table]).toContainEqual(row);
    }

    const oldTx = await h!.driver.all<{ account_id: string; seq: number; amount_minor: number; kind: string; id: string }>(
      'SELECT a.name AS account_id, t.seq, t.amount_minor, t.kind, t.id FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.workspace_id = ? ORDER BY a.name, t.seq',
      [s.wsA],
    );
    const newTx = await h!.driver.all<{ account_id: string; seq: number; amount_minor: number; kind: string; id: string }>(
      'SELECT a.name AS account_id, t.seq, t.amount_minor, t.kind, t.id FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.workspace_id = ? ORDER BY a.name, t.seq',
      [ws.id],
    );
    expect(newTx.map(({ id: _id, ...r }) => r)).toEqual(oldTx.map(({ id: _id, ...r }) => r));
    const oldIds = new Set(oldTx.map((r) => r.id));
    expect(newTx.some((r) => oldIds.has(r.id))).toBe(false);

    // next_seq consistente: el siguiente seq reservado sigue la serie.
    const accounts = await h!.driver.all<{ id: string; name: string; next_seq: number }>(
      'SELECT id, name, next_seq FROM accounts WHERE workspace_id = ? ORDER BY name',
      [ws.id],
    );
    expect(accounts.map((a) => [a.name, a.next_seq])).toEqual([['Banco', 2], ['Caja', 7]]);

    // Transferencia enlazada en el espacio nuevo, con grupo nuevo.
    const sides = await h!.driver.all<{ transfer_group_id: string; direction: string }>(
      "SELECT transfer_group_id, direction FROM transactions WHERE workspace_id = ? AND kind = 'transfer'",
      [ws.id],
    );
    expect(sides).toHaveLength(2);
    expect(sides[0]!.transfer_group_id).toBe(sides[1]!.transfer_group_id);
    expect(sides[0]!.transfer_group_id).not.toBe(s.transferGroup);

    // Fusión, vista guardada, historial y ajustes del espacio apuntan a los ids nuevos.
    const merged = await h!.driver.get<{ merged_into_id: string; target_label: string }>(
      `SELECT o.merged_into_id, t.label AS target_label FROM field_options o JOIN field_options t ON t.id = o.merged_into_id
       JOIN fields f ON f.id = o.field_id WHERE f.workspace_id = ? AND o.label = 'Luz'`,
      [ws.id],
    );
    expect(merged?.target_label).toBe('Electricidad');
    const view = await h!.driver.get<{ recipe: string }>('SELECT recipe FROM saved_views WHERE workspace_id = ?', [ws.id]);
    const newCash = accounts.find((a) => a.name === 'Caja')!.id;
    expect(view!.recipe).toContain(newCash);
    expect(view!.recipe).not.toContain(s.cash);
    expect(view!.recipe).not.toContain(s.fCat);
    const change = await h!.driver.get<{ path: string; new_value: string }>(
      'SELECT c.path, c.new_value FROM audit_log_changes c JOIN audit_log l ON l.id = c.action_id WHERE l.workspace_id = ?',
      [ws.id],
    );
    expect(change!.path.startsWith('field:')).toBe(true);
    expect(change!.path).not.toContain(s.fCat);
    expect(change!.new_value).not.toContain(s.oElectricidad);
    const wsSetting = await h!.driver.get<{ value: string }>(
      "SELECT value FROM settings WHERE scope_id = ? AND key = 'capture.lastAccountId'",
      [ws.id],
    );
    expect(JSON.parse(wsSetting!.value)).toBe(newCash);
    const imported = await h!.driver.get<{ action: string; entity_id: string }>(
      "SELECT action, entity_id FROM audit_log WHERE action = 'workspace_import'",
    );
    expect(imported).toEqual({ action: 'workspace_import', entity_id: ws.id });
    expect(await h!.driver.all('PRAGMA foreign_key_check')).toEqual([]);
    expect(await h!.driver.get("SELECT 1 FROM settings WHERE key = 'sys.maintenance'")).toBeUndefined();

    // Con rename y desde un respaldo completo.
    const all = await backup.export({ scope: 'all' });
    const again = await backup.importWorkspace(all.text, s.wsB, { rename: 'Personal (copia)' });
    expect(again.value.name).toBe('Personal (copia)');
    await expectCode(backup.importWorkspace(all.text, 'no-existe'), 'not_found');
  });

  it('restaurar todo guarda antes una copia automática y escribe backup_restore', async () => {
    const copies: AutoCopy[] = [];
    const { backup, s, events } = await setup({
      autoCopy: async (c) => {
        copies.push(c);
      },
    });
    const out = await backup.export({ scope: 'all' });
    await h!.driver.run("UPDATE workspaces SET name = 'Cambiado' WHERE id = ?", [s.wsA]);

    await backup.restoreAll(out.text, { confirm: true });
    expect(copies).toHaveLength(1);
    const copy = copies[0]!;
    // La copia es el estado de justo antes: archivo SQLite completo y respaldo JSON con el nombre cambiado.
    expect(new TextDecoder().decode(copy.bytes.subarray(0, 15))).toBe('SQLite format 3');
    expect(copy.json).toContain('Cambiado');
    expect(copy.name).toMatch(/^cuadra-antes-de-restaurar-2026-06-15T12-00-00\.cuadra\.json$/);

    const ws = await h!.driver.get<{ name: string }>('SELECT name FROM workspaces WHERE id = ?', [s.wsA]);
    expect(ws?.name).toBe('Colmado La Esquina');
    const restored = await h!.driver.all<{ action: string; entity_type: string; workspace_id: string | null; params: string }>(
      "SELECT action, entity_type, workspace_id, params FROM audit_log WHERE action = 'backup_restore'",
    );
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ entity_type: 'installation', workspace_id: null });
    expect(JSON.parse(restored[0]!.params)).toMatchObject({ workspaces: 2, transactions: 8 });
    expect(events.at(-1)?.reason).toBe('backup.restore');

    // Sin destino externo, la copia queda dentro de la propia base (clave sys.*, que la restauración no pisa).
    h!.clock.set('2026-06-16T09:30:00Z');
    const local = createBackupService(coreDeps(h!));
    await local.restoreAll(out.text, { confirm: true });
    const stored = await local.lastAutoCopy();
    expect(stored?.name).toBe('cuadra-antes-de-restaurar-2026-06-16T09-30-00.cuadra.json');
    expect((await local.inspect(stored!.json)).ok).toBe(true);
  });

  it('si la copia automática falla no se restaura nada', async () => {
    const { s } = await setup();
    const failing = createBackupService(coreDeps(h!), {
      autoCopy: async () => {
        throw new Error('disco lleno');
      },
    });
    const out = await failing.export({ scope: 'all' });
    await h!.driver.run("UPDATE workspaces SET name = 'Cambiado' WHERE id = ?", [s.wsA]);
    await expect(failing.restoreAll(out.text, { confirm: true })).rejects.toThrow('disco lleno');
    const ws = await h!.driver.get<{ name: string }>('SELECT name FROM workspaces WHERE id = ?', [s.wsA]);
    expect(ws?.name).toBe('Cambiado');
  });

  it('una restauración que rompe claves foráneas hace ROLLBACK y no deja el modo mantenimiento', async () => {
    const { backup, s } = await setup();
    const out = await backup.export({ scope: 'all' });
    const broken = await rewrite(out.text, (f) => {
      const t = f.tables.transaction_field_values;
      t.rows[0]![t.columns.indexOf('value_option_id')] = '01900000-0000-7000-8000-000000000404';
    });
    await h!.driver.run("UPDATE workspaces SET name = 'Cambiado' WHERE id = ?", [s.wsA]);
    await expectCode(backup.restoreAll(broken, { confirm: true }), 'backup_invalid');
    // Clave foránea rota sin trigger que la cace antes: la detecta PRAGMA foreign_key_check.
    const dangling = await rewrite(out.text, (f) => {
      const t = f.tables.transactions;
      t.rows[0]![t.columns.indexOf('batch_id')] = '01900000-0000-7000-8000-000000000405';
    });
    try {
      await backup.restoreAll(dangling, { confirm: true });
      throw new Error('debía fallar');
    } catch (e) {
      expect(isDomainError(e, 'backup_invalid')).toBe(true);
      expect((e as { details?: { reason?: string } }).details?.reason).toBe('foreign_keys');
    }
    const ws = await h!.driver.get<{ name: string }>('SELECT name FROM workspaces WHERE id = ?', [s.wsA]);
    expect(ws?.name).toBe('Cambiado');
    expect(await h!.driver.get("SELECT 1 FROM settings WHERE key = 'sys.maintenance'")).toBeUndefined();
  });

  it('restoreAll rechaza un respaldo de un solo espacio y exige confirmación', async () => {
    const { backup, s } = await setup();
    const one = await backup.export({ scope: 'workspace', workspaceId: s.wsA });
    await expectCode(backup.restoreAll(one.text, { confirm: true }), 'backup_invalid');
    const all = await backup.export({ scope: 'all' });
    await expectCode(backup.restoreAll(all.text, { confirm: false as unknown as true }), 'confirmation_mismatch');
    await expectCode(backup.export({ scope: 'workspace', workspaceId: 'no-existe' }), 'not_found');
  });

  it('respaldo cifrado: inspect pide contraseña, la incorrecta falla y la buena restaura', async () => {
    const { backup, s } = await setup();
    const out = await backup.export({ scope: 'all', password: 'clave segura' });
    expect(out.encrypted).toBe(true);
    expect(out.verified).toBe(true);
    expect(out.text).toContain('"format":"cuadra-encrypted"');
    expect(out.text).not.toContain('Colmado');

    const locked = await backup.inspect(out.text);
    expect(locked).toMatchObject({ ok: false, encrypted: true, error: 'password_required' });
    const wrong = await backup.inspect(out.text, { password: 'otra' });
    expect(wrong).toMatchObject({ ok: false, encrypted: true, error: 'wrong_password' });
    const open = await backup.inspect(out.text, { password: 'clave segura' });
    expect(open).toMatchObject({ ok: true, encrypted: true, scope: 'all', formatVersion: 1, schemaVersion: 1, needsUpgrade: false });
    expect(open.workspaces).toEqual([
      { id: s.wsA, name: 'Colmado La Esquina', transactions: 7, accounts: 2 },
      { id: s.wsB, name: 'Finanzas personales', transactions: 1, accounts: 1 },
    ]);

    await expectCode(backup.restoreAll(out.text, { confirm: true }), 'password_required');
    await expectCode(backup.restoreAll(out.text, { confirm: true, password: 'otra' }), 'wrong_password');
    await h!.driver.run("UPDATE workspaces SET name = 'Cambiado' WHERE id = ?", [s.wsA]);
    await backup.restoreAll(out.text, { confirm: true, password: 'clave segura' });
    const ws = await h!.driver.get<{ name: string }>('SELECT name FROM workspaces WHERE id = ?', [s.wsA]);
    expect(ws?.name).toBe('Colmado La Esquina');
    const m = await backup.importWorkspace(out.text, s.wsB, { password: 'clave segura' });
    expect(m.value.name).toBe('Finanzas personales (2)');
  });

  it('un sobre cifrado que no contiene un respaldo → backup_invalid', async () => {
    const { backup } = await setup();
    const env = await encryptText('x', 'no soy json', { iterations: 1000 });
    const r = await backup.inspect(JSON.stringify(env), { password: 'x' });
    expect(r).toMatchObject({ ok: false, encrypted: true, error: 'backup_invalid' });
  });

  it('inspect no escribe nada y rechaza archivos que no son respaldos', async () => {
    const { backup } = await setup();
    const before = await h!.driver.transaction((tx) => dump(tx));
    for (const bad of ['', 'hola', '{}', '[]', JSON.stringify({ format: 'cuadra-backup', formatVersion: 1 })]) {
      const r = await backup.inspect(bad);
      expect(r.ok).toBe(false);
      expect(r.error).toBe('backup_invalid');
    }
    const out = await backup.export({ scope: 'all' });
    const r = await backup.inspect(out.text);
    expect(r).toMatchObject({ ok: true, encrypted: false, appVersion: '0.1.0', createdAt: '2026-06-15T12:00:00.000Z' });
    expect(await h!.driver.transaction((tx) => dump(tx))).toEqual(before);
    // Conteos que no cuadran con las filas también invalidan.
    const lying = await rewrite(out.text, (f) => {
      f.counts.transactions = 3;
    });
    expect((await backup.inspect(lying)).error).toBe('backup_invalid');
  });

  it('markVerified guarda backup.lastVerifiedAt', async () => {
    const { backup } = await setup();
    await backup.markVerified();
    const row = await h!.driver.get<{ value: string }>("SELECT value FROM settings WHERE scope_id = '' AND key = 'backup.lastVerifiedAt'");
    expect(JSON.parse(row!.value)).toBe('2026-06-15T12:00:00.000Z');
    await backup.markVerified('2026-06-20T08:00:00.000Z');
    const again = await h!.driver.get<{ value: string }>("SELECT value FROM settings WHERE scope_id = '' AND key = 'backup.lastVerifiedAt'");
    expect(JSON.parse(again!.value)).toBe('2026-06-20T08:00:00.000Z');
  });
});

describe('backup-upgrades', () => {
  const base = (schemaVersion: number): BackupFile => ({
    format: 'cuadra-backup',
    formatVersion: 1,
    schemaVersion,
    appVersion: '0.0.1',
    createdAt: T0,
    scope: 'all',
    workspaceIds: ['w'],
    checksum: '',
    counts: Object.fromEntries(BACKUP_TABLES.map((t) => [t, 0])) as BackupFile['counts'],
    tables: Object.fromEntries(BACKUP_TABLES.map((t) => [t, { columns: ['id'], rows: [] }])) as unknown as BackupFile['tables'],
  });

  it('aplica en cadena los upgraders desde la versión del archivo hasta la actual', () => {
    const file = base(1);
    file.tables.accounts = { columns: ['id', 'name'], rows: [['a', 'Caja']] };
    file.counts.accounts = 1;
    const chain: BackupUpgrader[] = [
      {
        from: 1,
        to: 2,
        upgrade: (f) => {
          const t = f.tables.accounts;
          t.columns.push('icon');
          for (const r of t.rows) r.push('wallet');
          return f;
        },
      },
      {
        from: 2,
        to: 3,
        upgrade: (f) => {
          const t = f.tables.accounts;
          t.columns[t.columns.indexOf('name')] = 'title';
          return f;
        },
      },
    ];
    const up = upgradeBackup(file, 3, chain);
    expect(up.schemaVersion).toBe(3);
    expect(up.tables.accounts).toEqual({ columns: ['id', 'title', 'icon'], rows: [['a', 'Caja', 'wallet']] });
    expect(file.schemaVersion).toBe(1); // no muta la entrada
  });

  it('sin upgrader para un salto → backup_invalid; versión actual → sin cambios', () => {
    expect(upgradeBackup(base(1), 1).schemaVersion).toBe(1);
    try {
      upgradeBackup(base(1), 2, []);
      throw new Error('debía fallar');
    } catch (e) {
      expect(isDomainError(e, 'backup_invalid')).toBe(true);
    }
  });
});

describe('backup con los servicios reales', () => {
  it('lo creado con los servicios sobrevive a exportar, restaurar e importar como espacio nuevo', async () => {
    h = await createTestCuadra();
    const c = h.cuadra;
    const ws = (await c.workspaces.create({ name: 'Taller' })).value;
    const caja = (await c.accounts.create({ workspaceId: ws.id, name: 'Caja', opening: { amountMinor: 50000, direction: 'in', date: '2026-01-01' } })).value;
    const banco = (await c.accounts.create({ workspaceId: ws.id, name: 'Banco' })).value;
    const cat = (await c.fields.create({ workspaceId: ws.id, label: 'Categoría', type: 'list', options: [{ label: 'Ventas' }, { label: 'Luz' }, { label: 'Electricidad' }] })).value;
    const [ventas, luz, elec] = cat.options;
    const sale = (await c.transactions.create({ accountId: caja.id, kind: 'income', amountMinor: 12345, date: '2026-05-01', description: 'Venta', values: { [cat.id]: { type: 'list', optionId: ventas!.id } } })).value;
    await c.transactions.create({ accountId: caja.id, kind: 'expense', amountMinor: 2000, date: '2026-05-02', description: 'Luz', values: { [cat.id]: { type: 'list', optionId: luz!.id } } });
    await c.transactions.createTransfer({ fromAccountId: caja.id, toAccountId: banco.id, amountMinor: 10000, date: '2026-05-03', description: 'Depósito' });
    await c.transactions.update(sale.id, { amountMinor: 12500 });
    await c.transactions.void(sale.id, 'repetida');
    await c.fields.mergeOptions(luz!.id, elec!.id);

    const backup = createBackupService(coreDeps(h));
    const before = await h.driver.transaction((tx) => dump(tx));
    const balances = await c.queries.balances(ws.id);
    const out = await backup.export({ scope: 'all' });
    await c.transactions.create({ accountId: caja.id, kind: 'expense', amountMinor: 1, date: '2026-05-04', description: 'Después' });
    await backup.restoreAll(out.text, { confirm: true });
    expect(await h.driver.transaction((tx) => dump(tx, { skipRestoreAction: true }))).toEqual(before);
    expect(await c.queries.balances(ws.id)).toEqual(balances);

    const copy = (await backup.importWorkspace(out.text, ws.id)).value;
    const copied = await c.queries.balances(copy.id);
    expect(copied.totalMinor).toBe(balances.totalMinor);
    expect(Object.values(copied.byAccount).sort()).toEqual(Object.values(balances.byAccount).sort());
    // Los servicios siguen funcionando sobre el espacio importado: seq continúa sin huecos.
    const accounts = await c.accounts.list(copy.id);
    const newCaja = accounts.find((a) => a.name === 'Caja')!;
    const next = (await c.transactions.create({ accountId: newCaja.id, kind: 'income', amountMinor: 100, date: '2026-06-01', description: 'Nueva' })).value;
    const oldNext = (await c.transactions.create({ accountId: caja.id, kind: 'income', amountMinor: 100, date: '2026-06-01', description: 'Nueva' })).value;
    expect(next.seq).toBe(oldNext.seq);
    const fields = await c.fields.list(copy.id, { includeInactive: true });
    const newLuz = fields[0]!.options.find((o) => o.label === 'Luz')!;
    expect(newLuz.active).toBe(false);
    expect(fields[0]!.options.find((o) => o.id === newLuz.mergedIntoId)?.label).toBe('Electricidad');
  });
});
