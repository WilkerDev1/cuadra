// Módulo de plantillas: las plantillas empaquetadas (JSON validados) y las utilidades del formato.
// La carga de los JSON vive en schema.ts porque el núcleo solo puede importar templates/schema (1.3);
// este archivo es la entrada cómoda para pruebas y para quien no sea core.
import { BUNDLED_TEMPLATES, type TemplateFile } from './schema';

export * from './schema';

/** Ids de las plantillas que vienen con Cuadra. */
export const TEMPLATE_IDS: readonly string[] = Object.freeze(BUNDLED_TEMPLATES.map((t) => t.id));

/** Plantilla empaquetada por id, o undefined. */
export function getBundledTemplate(id: string): TemplateFile | undefined {
  return BUNDLED_TEMPLATES.find((t) => t.id === id);
}
