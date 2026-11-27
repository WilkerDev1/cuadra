// Plantillas (ARCHITECTURE.md 3.5). Stub de la Oleada 1: lo implementa la Oleada 2 (2B).
// TemplateFile/TemplatePreview: forma mínima mientras no exista src/templates/schema.ts (dueño: 2B).
// Cuando exista, este archivo debe reexportar el tipo de allí (`import type` está permitido en core).
import { notImplemented } from '../errors';
import type { AccountType, AppliesTo, Currency, FieldRole, FieldType, Mutation, ViewRecipe, Workspace } from '../types';
import type { CoreDeps } from '../uow';
import type { OpeningInput } from './accounts';

export interface TemplateFile {
  id: string; // 'negocio', 'personal', 'despacho', 'organizacion', 'blanco'
  version: number;
  name: string;
  description: string;
  currency?: Currency;
  accounts: Array<{ key: string; name: string; type: AccountType; color?: string; icon?: string }>;
  fields: Array<{
    key: string;
    label: string;
    type: FieldType;
    role?: FieldRole;
    appliesTo?: AppliesTo;
    showInList?: boolean;
    options?: Array<{ key: string; label: string; color?: string; appliesTo?: AppliesTo }>;
  }>;
  /** Recetas con claves de plantilla en lugar de ids (ver resolveTemplateRecipe). */
  views: Array<{ key: string; name: string; kind: ViewRecipe['kind']; pinned?: boolean; recipe: unknown }>;
}

export interface TemplatePreview {
  templateId: string;
  name: string;
  description: string;
  accounts: Array<{ key: string; name: string; type: AccountType }>;
  fields: Array<{ key: string; label: string; type: FieldType; options: string[] }>;
  views: Array<{ key: string; name: string; kind: ViewRecipe['kind'] }>;
}

export interface TemplatesService {
  list(): TemplateFile[]; // síncrono: son datos empaquetados
  preview(templateId: string): TemplatePreview; // lo que se va a crear (Frappe Books)
  apply(
    templateId: string,
    input: {
      name: string;
      ownerName?: string;
      currency: Currency;
      openingBalances?: Record<string /* account key */, OpeningInput>;
    },
  ): Promise<Mutation<Workspace>>;
}

export function createTemplatesService(_deps: CoreDeps): TemplatesService {
  return {
    list: () => notImplemented('templates.list'),
    preview: () => notImplemented('templates.preview'),
    apply: async () => notImplemented('templates.apply'),
  };
}
