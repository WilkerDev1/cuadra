// Junta todos los diccionarios `src/i18n/es/<ns>.ts` en uno solo, sin que nadie edite este archivo.
//
// Forma aceptada de cada archivo de cadenas (cualquiera de las dos):
//   export default { 'capture.save': 'Guardar' } as const;
//   export const dictionary = { capture: { save: 'Guardar' } } as const;   // anidado
// Las claves se aplanan con puntos. Si una clave no empieza por el espacio de nombres (el nombre
// del archivo) se le antepone: `save` dentro de `capture.ts` pasa a ser `capture.save`.

export type Dictionary = Readonly<Record<string, string>>;

type Tree = { readonly [key: string]: string | Tree };

const modules = import.meta.glob<Record<string, unknown>>(['./*.ts', '!./index.ts'], { eager: true });

function isTree(value: unknown): value is Tree {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function flatten(tree: Tree, prefix: string, out: Record<string, string>): void {
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') out[path] = value;
    else if (isTree(value)) flatten(value, path, out);
  }
}

/** Extrae el objeto de cadenas de un módulo: `default`, `dictionary` o el primer export objeto. */
function pickTree(mod: Record<string, unknown>): Tree | undefined {
  if (isTree(mod['default'])) return mod['default'];
  if (isTree(mod['dictionary'])) return mod['dictionary'];
  return Object.values(mod).find(isTree);
}

export function buildDictionary(entries: Record<string, Record<string, unknown>>): Dictionary {
  const out: Record<string, string> = {};
  for (const [file, mod] of Object.entries(entries)) {
    const ns = file.replace(/^\.\//, '').replace(/\.ts$/, '');
    const tree = pickTree(mod);
    if (tree === undefined) continue;
    const flat: Record<string, string> = {};
    flatten(tree, '', flat);
    for (const [key, text] of Object.entries(flat)) {
      out[key === ns || key.startsWith(`${ns}.`) ? key : `${ns}.${key}`] = text;
    }
  }
  return out;
}

export const dictionary: Dictionary = buildDictionary(modules);
