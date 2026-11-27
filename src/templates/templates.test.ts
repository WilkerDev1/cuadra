// Pruebas de plantillas (ARCHITECTURE.md 4.2, 86–89) y del módulo de plantillas: validar, importar un
// archivo externo y "guardar este espacio como plantilla".
import { afterEach, describe, expect, it } from 'vitest';
import { createTestCuadra, type TestCuadra } from '../test/harness';
import { parseViewRecipe, resolveTemplateRecipe, type TemplateKeyMap } from '../core/recipes';
import { BUNDLED_TEMPLATES, getBundledTemplate, TEMPLATE_IDS } from './index';
import {
  parseTemplateJson,
  serializeTemplate,
  TEMPLATE_FORMAT,
  TEMPLATE_FORMAT_VERSION,
  validateTemplateFile,
  type TemplateFile,
} from './schema';

let h: TestCuadra | undefined;
afterEach(async () => {
  await h?.driver.close();
  h = undefined;
});

async function setup() {
  h = await createTestCuadra();
  return h;
}

const count = async (t: TestCuadra, sql: string, params: string[] = []) =>
  (await t.driver.get<{ n: number }>(sql, params))?.n ?? 0;

/** Mapa de claves → claves: deja comprobar la forma de una receta de plantilla sin BD. */
function identityKeyMap(file: TemplateFile): TemplateKeyMap {
  const map: TemplateKeyMap = { accounts: {}, fields: {}, options: {} };
  for (const a of file.accounts) map.accounts[a.key] = a.key;
  for (const f of file.fields) {
    map.fields[f.key] = f.key;
    for (const o of f.options ?? []) map.options[`${f.key}.${o.key}`] = `${f.key}.${o.key}`;
  }
  return map;
}

describe('archivos de plantilla', () => {
  it('todas las plantillas JSON cumplen el esquema y sus claves son únicas', () => {
    expect([...TEMPLATE_IDS].sort()).toEqual(['blanco', 'despacho', 'negocio', 'organizacion', 'personal']);
    expect(BUNDLED_TEMPLATES.map((t) => t.id)).toEqual(['negocio', 'despacho', 'organizacion', 'personal', 'blanco']);
    for (const file of BUNDLED_TEMPLATES) {
      const result = validateTemplateFile(file);
      expect(result.ok ? [] : result.issues, file.id).toEqual([]);
      expect(file.format).toBe(TEMPLATE_FORMAT);
      expect(file.formatVersion).toBe(TEMPLATE_FORMAT_VERSION);

      const unique = (xs: string[]) => new Set(xs).size === xs.length;
      expect(unique(file.accounts.map((a) => a.key)), `${file.id}: cuentas`).toBe(true);
      expect(unique(file.fields.map((f) => f.key)), `${file.id}: campos`).toBe(true);
      expect(unique(file.views.map((v) => v.key)), `${file.id}: vistas`).toBe(true);
      for (const f of file.fields) {
        expect(unique((f.options ?? []).map((o) => o.key)), `${file.id}.${f.key}: opciones`).toBe(true);
        expect(unique((f.options ?? []).map((o) => o.label.toLowerCase())), `${file.id}.${f.key}: etiquetas`).toBe(true);
      }
      // Cada receta es válida según core/recipes una vez traducidas sus claves.
      const keyMap = identityKeyMap(file);
      for (const v of file.views) {
        const recipe = resolveTemplateRecipe(v.recipe, keyMap);
        expect(parseViewRecipe(recipe).ok, `${file.id}.${v.key}`).toBe(true);
        expect(recipe.kind).toBe(v.kind);
      }
    }
  });

  it('las plantillas de uso real traen lo que piden los perfiles', () => {
    const roles = (id: string) => new Set<string>(getBundledTemplate(id)?.fields.map((f) => f.role ?? f.type));
    for (const id of ['negocio', 'despacho', 'organizacion', 'personal']) {
      const r = roles(id);
      for (const role of ['category', 'payment_method', 'contact', 'reconciled']) expect(r.has(role), `${id}: ${role}`).toBe(true);
      const file = getBundledTemplate(id);
      expect(file?.views.some((v) => v.kind === 'filter'), id).toBe(true);
      expect(file?.views.some((v) => v.kind === 'summary'), id).toBe(true);
      expect(file?.views.some((v) => v.kind === 'report'), id).toBe(true);
    }
    expect(roles('negocio').has('reference')).toBe(true);
    expect(roles('despacho').has('cost_center')).toBe(true);
    expect(roles('organizacion').has('fund')).toBe(true);
    // Despacho ejercita los cinco tipos de campo.
    expect(new Set(getBundledTemplate('despacho')?.fields.map((f) => f.type))).toEqual(
      new Set(['text', 'number', 'date', 'list', 'bool']),
    );
    expect(getBundledTemplate('negocio')?.accounts.map((a) => a.key)).toEqual(['caja', 'banco', 'tarjeta']);
    expect(getBundledTemplate('despacho')?.accounts.map((a) => a.key)).toEqual([
      'banco_operativo',
      'tarjeta_empresarial',
      'caja_chica',
    ]);
  });

  it('el validador explica con rutas y mensajes legibles lo que está mal', () => {
    const bad = {
      format: 'cuadra-template',
      formatVersion: 1,
      id: 'Mi Plantilla',
      version: 1,
      name: '',
      description: 'x',
      accounts: [
        { key: 'caja', name: 'Caja', type: 'cash' },
        { key: 'caja', name: 'Caja 2', type: 'cofre' },
      ],
      fields: [
        { key: 'categoria', label: 'Categoría', type: 'list', options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'a' }] },
        { key: 'nota', label: 'Nota', type: 'text', options: [{ key: 'x', label: 'X' }] },
      ],
      views: [
        {
          key: 'v1',
          name: 'Vista',
          kind: 'filter',
          recipe: { v: 1, kind: 'filter', filter: { accountIds: ['banco'], fields: [{ fieldId: 'categoria', op: 'any_of', optionIds: ['zz'] }] } },
        },
        { key: 'v2', name: 'Resumen', kind: 'summary', recipe: { v: 1, kind: 'report' } },
      ],
    };
    const result = validateTemplateFile(bad);
    expect(result.ok).toBe(false);
    const paths = result.ok ? [] : result.issues.map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'accounts[1].key',
        'accounts[1].type',
        'fields[0].options[1].label',
        'fields[1].options',
        'views[0].recipe.filter.accountIds[0]',
        'views[0].recipe.filter.fields[0].optionIds[0]',
        'views[1].recipe.kind',
      ]),
    );
    if (!result.ok) {
      for (const issue of result.issues) expect(issue.message.length).toBeGreaterThan(10);
      expect(result.issues.find((i) => i.path === 'accounts[1].key')?.message).toMatch(/repet/i);
    }

    expect(validateTemplateFile({ ...BUNDLED_TEMPLATES[0], formatVersion: 99 })).toMatchObject({
      ok: false,
      issues: [{ path: 'formatVersion' }],
    });
    expect(parseTemplateJson('{ no es json')).toMatchObject({ ok: false, issues: [{ path: '$' }] });
    expect(validateTemplateFile([])).toMatchObject({ ok: false });
  });
});

describe('aplicar plantillas', () => {
  it('aplicar "negocio" crea cuentas, campos, opciones y vistas con una acción template_apply', async () => {
    const t = await setup();
    const file = getBundledTemplate('negocio');
    if (!file) throw new Error('falta negocio');
    const preview = t.cuadra.templates.preview('negocio');
    expect(preview.accounts.map((a) => a.name)).toEqual(file.accounts.map((a) => a.name));
    expect(preview.fields.find((f) => f.key === 'categoria')?.options.length).toBe(
      file.fields.find((f) => f.key === 'categoria')?.options?.length,
    );

    const audit0 = await count(t, 'SELECT COUNT(*) AS n FROM audit_log');
    const events: string[] = [];
    t.cuadra.subscribe((e) => events.push(e.reason));
    const applied = await t.cuadra.templates.apply('negocio', {
      name: 'Colmado La Esquina',
      ownerName: 'Juana Pérez',
      currency: { code: 'DOP', minorDigits: 2 },
    });
    const ws = applied.value;
    expect(ws).toMatchObject({ name: 'Colmado La Esquina', ownerName: 'Juana Pérez', templateId: 'negocio' });
    expect(events).toHaveLength(1);
    expect(await count(t, 'SELECT COUNT(*) AS n FROM audit_log')).toBe(audit0 + 1);
    const action = await t.driver.get<{ action: string; workspace_id: string }>('SELECT action, workspace_id FROM audit_log WHERE id = ?', [
      applied.auditActionId ?? '',
    ]);
    expect(action).toEqual({ action: 'template_apply', workspace_id: ws.id });

    const accounts = await t.cuadra.accounts.list(ws.id);
    expect(accounts.map((a) => a.name)).toEqual(file.accounts.map((a) => a.name));
    const fields = await t.cuadra.fields.list(ws.id);
    expect(fields.map((f) => f.key)).toEqual(file.fields.map((f) => f.key));
    const options = fields.reduce((n, f) => n + f.options.length, 0);
    expect(options).toBe(file.fields.reduce((n, f) => n + (f.options?.length ?? 0), 0));
    expect(fields.find((f) => f.key === 'categoria')?.options.every((o) => o.key !== null)).toBe(true);
    expect(await count(t, "SELECT COUNT(*) AS n FROM saved_views WHERE workspace_id = ? AND source = 'template'", [ws.id])).toBe(
      file.views.length,
    );
    expect(await count(t, 'SELECT COUNT(*) AS n FROM transactions WHERE workspace_id = ?', [ws.id])).toBe(0);
  });

  it('las recetas de plantilla se resuelven de claves a ids', async () => {
    const t = await setup();
    const ws = (await t.cuadra.templates.apply('negocio', { name: 'Colmado', currency: { code: 'DOP', minorDigits: 2 } })).value;
    const fields = await t.cuadra.fields.list(ws.id);
    const accounts = await t.cuadra.accounts.list(ws.id);
    const fieldIds = new Set(fields.map((f) => f.id));
    const optionIds = new Set(fields.flatMap((f) => f.options.map((o) => o.id)));
    const accountIds = new Set(accounts.map((a) => a.id));
    const keys = new Set([...fields.map((f) => f.key), ...accounts.map((a) => a.name)]);

    const rows = await t.driver.all<{ kind: string; recipe: string }>('SELECT kind, recipe FROM saved_views WHERE workspace_id = ?', [
      ws.id,
    ]);
    let checked = 0;
    for (const row of rows) {
      const parsed = parseViewRecipe(JSON.parse(row.recipe));
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) continue;
      const r = parsed.value;
      expect(r.kind).toBe(row.kind);
      for (const id of r.filter.accountIds ?? []) {
        expect(accountIds.has(id)).toBe(true);
        checked++;
      }
      for (const c of r.filter.fields ?? []) {
        expect(fieldIds.has(c.fieldId)).toBe(true);
        expect(keys.has(c.fieldId)).toBe(false);
        if (c.op === 'any_of') for (const o of c.optionIds) expect(optionIds.has(o)).toBe(true);
        checked++;
      }
      if (r.kind === 'summary' && r.groupBy.by === 'field') {
        expect(fieldIds.has(r.groupBy.fieldId)).toBe(true);
        checked++;
      }
      if (r.kind === 'report') {
        for (const id of r.groupByFieldIds) expect(fieldIds.has(id)).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('aplicar con saldos iniciales crea movimientos de saldo inicial y omite los cero', async () => {
    const t = await setup();
    const ws = (
      await t.cuadra.templates.apply('negocio', {
        name: 'Colmado',
        currency: { code: 'DOP', minorDigits: 2 },
        openingBalances: {
          caja: { amountMinor: 1_500_000, direction: 'in', date: '2026-01-01' },
          banco: { amountMinor: 0, direction: 'in', date: '2026-01-01' },
          tarjeta: { amountMinor: 850_000, direction: 'out', date: '2026-01-01' },
        },
      })
    ).value;
    const rows = await t.driver.all<{ name: string; kind: string; direction: string; amount_minor: number; seq: number }>(
      `SELECT a.name, t.kind, t.direction, t.amount_minor, t.seq FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.workspace_id = ? ORDER BY a.sort_order`,
      [ws.id],
    );
    expect(rows).toEqual([
      { name: 'Caja', kind: 'opening', direction: 'in', amount_minor: 1_500_000, seq: 1 },
      { name: 'Tarjeta de crédito', kind: 'opening', direction: 'out', amount_minor: 850_000, seq: 1 },
    ]);
    const balances = await t.cuadra.accounts.list(ws.id);
    expect(balances.map((a) => a.balanceMinor)).toEqual([1_500_000, 0, -850_000]);
    expect(await count(t, 'SELECT COUNT(*) AS n FROM audit_log WHERE workspace_id = ?', [ws.id])).toBe(1);

    await expect(
      t.cuadra.templates.apply('negocio', {
        name: 'Otro',
        currency: { code: 'DOP', minorDigits: 2 },
        openingBalances: { cofre: { amountMinor: 100, direction: 'in', date: '2026-01-01' } },
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    // Nada quedó a medias.
    expect(await count(t, 'SELECT COUNT(*) AS n FROM workspaces')).toBe(1);
    await expect(t.cuadra.templates.apply('nada', { name: 'X', currency: { code: 'DOP', minorDigits: 2 } })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('todas las plantillas empaquetadas se aplican', async () => {
    const t = await setup();
    for (const file of t.cuadra.templates.list()) {
      const ws = (await t.cuadra.templates.apply(file.id, { name: file.name, currency: { code: 'DOP', minorDigits: 2 } })).value;
      expect((await t.cuadra.fields.list(ws.id)).length).toBe(file.fields.length);
      expect(await count(t, 'SELECT COUNT(*) AS n FROM saved_views WHERE workspace_id = ?', [ws.id])).toBe(file.views.length);
    }
  });
});

describe('guardar e importar plantillas', () => {
  it('exportFromWorkspace guarda la estructura sin movimientos y se puede volver a aplicar', async () => {
    const t = await setup();
    const ws = (
      await t.cuadra.templates.apply('despacho', {
        name: 'Estudio Brisa',
        currency: { code: 'DOP', minorDigits: 2 },
        openingBalances: { banco_operativo: { amountMinor: 31_000_000, direction: 'in', date: '2026-01-01' } },
      })
    ).value;
    // Cambios del usuario que la plantilla exportada debe reflejar.
    const fields = await t.cuadra.fields.list(ws.id);
    const categoria = fields.find((f) => f.key === 'categoria');
    if (!categoria) throw new Error('sin categoría');
    await t.cuadra.fields.addOption(categoria.id, { label: 'Capacitación del personal', appliesTo: 'out' });
    const firstOption = categoria.options[0];
    if (!firstOption) throw new Error('sin opciones');
    await t.cuadra.fields.deactivateOption(firstOption.id);
    const horas = fields.find((f) => f.type === 'number');
    if (horas) await t.cuadra.fields.deactivate(horas.id);
    await t.cuadra.accounts.create({ workspaceId: ws.id, name: 'Cuenta en dólares', type: 'bank' });

    const exported = await t.cuadra.templates.exportFromWorkspace(ws.id, { name: 'Mi despacho' });
    expect(validateTemplateFile(exported)).toMatchObject({ ok: true });
    expect(exported).toMatchObject({ format: TEMPLATE_FORMAT, name: 'Mi despacho', currency: { code: 'DOP', minorDigits: 2 } });
    expect(exported.accounts.map((a) => a.name)).toContain('Cuenta en dólares');
    const cat = exported.fields.find((f) => f.key === 'categoria');
    expect(cat?.options?.map((o) => o.label)).toContain('Capacitación del personal');
    expect(cat?.options?.map((o) => o.label)).not.toContain(firstOption.label);
    if (horas) expect(exported.fields.map((f) => f.key)).not.toContain(horas.key);
    expect(JSON.stringify(exported)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-7/); // ni un id de la BD
    expect(JSON.stringify(exported)).not.toContain('31000000');

    // Ida y vuelta por texto: lo que se descarga se puede importar y aplicar.
    const json = serializeTemplate(exported);
    const imported = t.cuadra.templates.parse(json);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const copy = (await t.cuadra.templates.apply(imported.value, { name: 'Copia', currency: { code: 'DOP', minorDigits: 2 } })).value;
    expect(copy.templateId).toBe(exported.id);
    const copyFields = await t.cuadra.fields.list(copy.id);
    expect(copyFields.map((f) => f.label)).toEqual(exported.fields.map((f) => f.label));
    expect(await count(t, 'SELECT COUNT(*) AS n FROM saved_views WHERE workspace_id = ?', [copy.id])).toBe(exported.views.length);
    expect(await count(t, 'SELECT COUNT(*) AS n FROM transactions WHERE workspace_id = ?', [copy.id])).toBe(0);
  });

  it('validate rechaza una plantilla externa con recetas mal formadas y apply no escribe nada', async () => {
    const t = await setup();
    const base = getBundledTemplate('personal');
    if (!base) throw new Error('falta personal');
    const broken: unknown = {
      ...base,
      id: 'externa',
      views: [{ key: 'x', name: 'Rota', kind: 'summary', recipe: { v: 1, kind: 'summary', filter: {}, groupBy: { by: 'field', fieldId: 'categoria' }, measure: 'mucho', chart: 'bars' } }],
    };
    const result = t.cuadra.templates.validate(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toMatch(/^views\[0\]\.recipe/);
    await expect(
      t.cuadra.templates.apply(broken as TemplateFile, { name: 'X', currency: { code: 'DOP', minorDigits: 2 } }),
    ).rejects.toMatchObject({ code: 'invalid_recipe' });
    expect(await count(t, 'SELECT COUNT(*) AS n FROM workspaces')).toBe(0);
  });
});
