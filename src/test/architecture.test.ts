// Reglas de dependencia de ARCHITECTURE.md §1.3, comprobadas leyendo los `import` de src/**.
// Tolera carpetas que aún no existen: solo recorre lo que hay.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname, '..');

type Layer =
  | 'core'
  | 'data'
  | 'data-node'
  | 'templates'
  | 'i18n'
  | 'ui'
  | 'registry'
  | 'app-data'
  | 'app-state'
  | 'app-shell'
  | 'feature'
  | 'test'
  | 'other';

interface Node {
  layer: Layer;
  /** Ruta relativa a src sin extensión, con `/`. */
  path: string;
  /** Nombre de la feature, si aplica. */
  feature?: string;
}

const stripExt = (p: string) => p.replace(/\.(d\.ts|tsx?|css|sql|json)$/, '');

export function classify(relPath: string): Node {
  const path = stripExt(relPath.split(sep).join('/'));
  const [top = '', second = ''] = path.split('/');
  if (/\.test$/.test(path) || top === 'test') return { layer: 'test', path };
  if (top === 'core') return { layer: 'core', path };
  if (top === 'data') return { layer: second === 'node' ? 'data-node' : 'data', path };
  if (top === 'templates') return { layer: 'templates', path };
  if (top === 'i18n') return { layer: 'i18n', path };
  if (top === 'ui') return { layer: 'ui', path };
  if (top === 'features') return { layer: 'feature', path, feature: second };
  if (top === 'app') {
    if (second === 'registry') return { layer: 'registry', path };
    if (second === 'data') return { layer: 'app-data', path };
    if (second === 'state') return { layer: 'app-state', path };
    return { layer: 'app-shell', path };
  }
  if (path === 'main') return { layer: 'app-shell', path };
  return { layer: 'other', path };
}

/** Módulos puros de core que la UI puede importar (todo menos servicios, SQL y unidad de trabajo). */
const isPureCore = (path: string) => path.startsWith('core/') && !/^core\/(services|sql|uow|ports)(\/|$)/.test(path);
const isCoreFacade = (path: string) => path === 'core/index';

type Verdict = string | null;

/** Devuelve el motivo de la violación o null si el import está permitido. */
export function checkInternal(from: Node, to: Node): Verdict {
  const deny = (why: string) => `${from.path} no puede importar ${to.path} (${why})`;
  switch (from.layer) {
    case 'test':
    case 'other':
      return null;
    case 'core':
      if (to.layer === 'core') return null;
      if (to.path === 'templates/schema') return null;
      return deny('core solo importa core y templates/schema');
    case 'data':
      if (to.layer === 'data') return null;
      if (to.path === 'core/ports' || to.path === 'core/errors') return null;
      if (to.layer === 'data-node') return deny('data/node es solo para pruebas');
      return deny('data solo importa core/ports y core/errors');
    case 'data-node':
      if (to.layer === 'data-node' || to.layer === 'data') return null;
      if (to.path === 'core/ports' || to.path === 'core/errors') return null;
      return deny('data/node solo importa data y core/ports|errors');
    case 'templates':
      if (to.layer === 'templates' || to.path === 'core/types') return null;
      return deny('templates solo importa core/types');
    case 'i18n':
      if (to.layer === 'i18n') return null;
      if (['core/money', 'core/dates', 'core/types'].includes(to.path)) return null;
      return deny('i18n solo importa core/money, core/dates y core/types');
    case 'ui':
      if (to.layer === 'ui' || to.layer === 'i18n') return null;
      if (['core/types', 'core/money', 'core/dates'].includes(to.path)) return null;
      return deny('ui solo importa módulos puros de core, i18n y ui');
    case 'registry':
    case 'app-data':
    case 'app-state':
      if (to.layer === 'registry' || to.layer === 'app-data' || to.layer === 'app-state') return null;
      if (to.layer === 'ui' || to.layer === 'i18n') return null;
      if (isCoreFacade(to.path) || isPureCore(to.path)) return null;
      return deny('app/registry|data|state no importa features, shell, data ni servicios de core');
    case 'app-shell':
      if (to.layer === 'app-shell' || to.layer === 'registry' || to.layer === 'app-data') return null;
      if (to.layer === 'app-state' || to.layer === 'ui' || to.layer === 'i18n') return null;
      if (isCoreFacade(to.path) || isPureCore(to.path) || to.path === 'data/index') return null;
      if (to.layer === 'feature') {
        return /^features\/[^/]+\/index$/.test(to.path) ? null : deny('el shell solo puede tocar features/*/index');
      }
      return deny('el shell no importa servicios de core ni adaptadores salvo data/index');
    case 'feature':
      if (to.layer === 'feature') return to.feature === from.feature ? null : deny('las features no se importan entre sí');
      if (to.layer === 'ui' || to.layer === 'i18n' || to.layer === 'registry') return null;
      if (to.layer === 'app-data' || to.layer === 'app-state') return null;
      if (isCoreFacade(to.path) || isPureCore(to.path)) return null;
      return deny('una feature no importa shell, data ni servicios de core');
  }
}

const NODE_BUILTIN = /^node:/;
const matches = (spec: string, names: readonly string[]) =>
  names.some((n) => spec === n || spec.startsWith(`${n}/`));

/** Paquetes externos permitidos por capa (`null` = sin restricción salvo la lista negra común). */
export function checkExternal(from: Node, spec: string): Verdict {
  const deny = (why: string) => `${from.path} no puede importar el paquete "${spec}" (${why})`;
  if (from.layer === 'test' || from.layer === 'other') return null;
  if (NODE_BUILTIN.test(spec) && from.layer !== 'data-node') return deny('node:* solo en data/node y pruebas');
  if (from.layer === 'core') {
    const allowed = ['date-fns'];
    if (from.path === 'core/services/importCsv') allowed.push('papaparse');
    return matches(spec, allowed) ? null : deny('core solo usa date-fns (y papaparse en importCsv)');
  }
  if (from.layer === 'templates') return deny('templates no importa paquetes');
  if (from.layer === 'data' || from.layer === 'data-node') {
    return matches(spec, ['@sqlite.org/sqlite-wasm', '@tauri-apps/api']) || from.layer === 'data-node' ? null : deny('data solo usa sqlite-wasm y tauri api');
  }
  if (from.layer === 'i18n') {
    return matches(spec, ['react', 'date-fns']) ? null : deny('i18n solo usa react y date-fns');
  }
  if (matches(spec, ['@sqlite.org/sqlite-wasm', '@tauri-apps/api'])) {
    return from.path === 'app/boot' ? null : deny('los adaptadores de datos solo los toca data/');
  }
  return null;
}

/** Quita comentarios para no leer imports dentro de ejemplos de documentación. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

export function extractSpecifiers(code: string): string[] {
  const specs: string[] = [];
  for (const m of stripComments(code).matchAll(IMPORT_RE)) specs.push((m[1] ?? m[2]) as string);
  return specs;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Ruta relativa a src del módulo importado. `'../core'` (carpeta) resuelve a `core/index`, la fachada. */
export function resolveTarget(file: string, spec: string): string {
  const abs = resolve(dirname(file), spec.split('?')[0] as string);
  return relative(SRC, isDirectory(abs) ? join(abs, 'index') : abs);
}

export function findViolations(files: string[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const rel = relative(SRC, file);
    const from = classify(rel);
    for (const spec of extractSpecifiers(readFileSync(file, 'utf8'))) {
      let verdict: Verdict;
      if (spec.startsWith('.')) {
        verdict = checkInternal(from, classify(resolveTarget(file, spec)));
      } else if (spec.startsWith('virtual:') || spec.startsWith('/')) {
        verdict = null;
      } else {
        verdict = checkExternal(from, spec);
      }
      if (verdict !== null) violations.push(`${rel}: ${verdict}`);
    }
  }
  return violations;
}

describe('reglas de dependencia (ARCHITECTURE.md 1.3)', () => {
  it('el árbol actual no viola ninguna regla', () => {
    expect(findViolations(walk(SRC))).toEqual([]);
  });

  describe('las reglas detectan violaciones (para que la prueba no sea vacía)', () => {
    const n = (p: string) => classify(p);
    it('core no importa UI ni datos', () => {
      expect(checkInternal(n('core/money.ts'), n('ui/index.ts'))).not.toBeNull();
      expect(checkInternal(n('core/money.ts'), n('data/index.ts'))).not.toBeNull();
      expect(checkInternal(n('core/money.ts'), n('core/dates.ts'))).toBeNull();
      expect(checkExternal(n('core/money.ts'), 'react')).not.toBeNull();
      expect(checkExternal(n('core/money.ts'), 'node:fs')).not.toBeNull();
      expect(checkExternal(n('core/dates.ts'), 'date-fns')).toBeNull();
      expect(checkExternal(n('core/services/importCsv.ts'), 'papaparse')).toBeNull();
      expect(checkExternal(n('core/services/queries.ts'), 'papaparse')).not.toBeNull();
    });
    it('data solo ve ports y errors, y data/node es solo de pruebas', () => {
      expect(checkInternal(n('data/index.ts'), n('core/services/queries.ts'))).not.toBeNull();
      expect(checkInternal(n('data/wasm/wasmDriver.ts'), n('core/ports.ts'))).toBeNull();
      expect(checkInternal(n('app/boot.ts'), n('data/node/nodeDriver.ts'))).not.toBeNull();
      expect(checkInternal(n('test/harness.ts'), n('data/node/nodeDriver.ts'))).toBeNull();
      expect(checkExternal(n('data/node/nodeDriver.ts'), 'node:sqlite')).toBeNull();
      expect(checkExternal(n('data/index.ts'), 'node:fs')).not.toBeNull();
    });
    it('ui no importa app, features ni servicios', () => {
      expect(checkInternal(n('ui/primitives/Button.tsx'), n('app/registry/types.ts'))).not.toBeNull();
      expect(checkInternal(n('ui/domain/MoneyText.tsx'), n('core/index.ts'))).not.toBeNull();
      expect(checkInternal(n('ui/domain/MoneyText.tsx'), n('core/money.ts'))).toBeNull();
    });
    it('las features no se importan entre sí ni tocan shell/data/servicios', () => {
      expect(checkInternal(n('features/ledger/hooks.ts'), n('features/capture/index.ts'))).not.toBeNull();
      expect(checkInternal(n('features/ledger/hooks.ts'), n('features/ledger/routes/List.tsx'))).toBeNull();
      expect(checkInternal(n('features/ledger/hooks.ts'), n('app/shell/AppShell.tsx'))).not.toBeNull();
      expect(checkInternal(n('features/ledger/hooks.ts'), n('data/index.ts'))).not.toBeNull();
      expect(checkInternal(n('features/ledger/hooks.ts'), n('core/services/queries.ts'))).not.toBeNull();
      expect(checkInternal(n('features/ledger/hooks.ts'), n('core/index.ts'))).toBeNull();
      expect(checkInternal(n('features/ledger/hooks.ts'), n('app/data/hooks.ts'))).toBeNull();
    });
    it('el shell solo toca features/*/index', () => {
      expect(checkInternal(n('app/router.tsx'), n('features/home/index.ts'))).toBeNull();
      expect(checkInternal(n('app/router.tsx'), n('features/home/routes/Home.tsx'))).not.toBeNull();
      expect(checkInternal(n('app/registry/collect.ts'), n('features/home/index.ts'))).not.toBeNull();
    });
    it('importar la carpeta core cuenta como la fachada core/index', () => {
      const target = resolveTarget(join(SRC, 'app', 'boot.ts'), '../core');
      expect(target).toBe(join('core', 'index'));
      expect(checkInternal(n('app/boot.ts'), n(target))).toBeNull();
      expect(checkInternal(n('ui/index.ts'), n(resolveTarget(join(SRC, 'ui', 'index.ts'), '../core')))).not.toBeNull();
    });
    it('extractSpecifiers lee import, export from e import()', () => {
      const code = `import a from './a';\nimport type { B } from "../b";\nexport * from './c';\nconst d = import('./d');\nimport './e.css';\n// import x from './comentado'`;
      expect(extractSpecifiers(code)).toEqual(['./a', '../b', './c', './d', './e.css']);
    });
  });
});
