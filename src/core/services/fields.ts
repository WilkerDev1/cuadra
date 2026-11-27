// Campos y opciones (ARCHITECTURE.md 3.5). Stub de la Oleada 1: lo implementa la Oleada 2 (2B).
import { notImplemented } from '../errors';
import type { AppliesTo, Field, FieldOption, FieldRole, FieldType, Id, Mutation } from '../types';
import type { CoreDeps } from '../uow';

export interface FormSchema {
  // F-25: lo que el formulario pinta, ya ordenado
  fields: Array<Field & { options: FieldOption[] /* solo activas y aplicables al tipo */ }>;
}

export interface FieldsService {
  list(workspaceId: Id, opts?: { includeInactive?: boolean }): Promise<Field[]>;
  formSchema(workspaceId: Id, kind: 'income' | 'expense' | 'transfer'): Promise<FormSchema>;
  /** Campos disponibles para filtrar/agrupar: incluye inactivos (marcados) para lo histórico. */
  dimensions(workspaceId: Id): Promise<Array<Field & { groupable: boolean; filterable: boolean }>>;
  create(input: {
    workspaceId: Id;
    label: string;
    type: FieldType;
    key?: string;
    role?: FieldRole;
    appliesTo?: AppliesTo;
    showInList?: boolean;
    options?: Array<{ label: string; color?: string; appliesTo?: AppliesTo }>;
  }): Promise<Mutation<Field>>;
  /** El tipo NO está en el parche (F-31). */
  update(id: Id, patch: Partial<Pick<Field, 'label' | 'role' | 'appliesTo' | 'showInList'>>): Promise<Mutation<Field>>;
  reorder(workspaceId: Id, ids: Id[]): Promise<void>;
  deactivate(id: Id): Promise<Mutation<Field>>;
  reactivate(id: Id): Promise<Mutation<Field>>;
  usage(id: Id): Promise<{ total: number; active: number; voided: number }>;
  /** Solo si usage.total === 0 (incluye anulados) → si no, 'field_in_use'. */
  delete(id: Id): Promise<void>;

  addOption(fieldId: Id, input: { label: string; color?: string; appliesTo?: AppliesTo }): Promise<Mutation<FieldOption>>;
  updateOption(
    optionId: Id,
    patch: Partial<Pick<FieldOption, 'label' | 'color' | 'appliesTo'>>,
  ): Promise<Mutation<FieldOption>>;
  reorderOptions(fieldId: Id, ids: Id[]): Promise<void>;
  deactivateOption(optionId: Id): Promise<Mutation<FieldOption>>;
  reactivateOption(optionId: Id): Promise<Mutation<FieldOption>>;
  deleteOption(optionId: Id): Promise<void>; // solo nunca usada
  /** Opciones parecidas al escribir (F-35 resuelto como "punto medio"): sin tildes, distancia ≤ 2. */
  similarOptions(fieldId: Id, label: string): Promise<FieldOption[]>;
  /** F-36: mueve valores al destino, desactiva el origen con merged_into_id, una acción de historial. */
  mergeOptions(sourceId: Id, targetId: Id): Promise<Mutation<{ movedCount: number }>>;
}

export function createFieldsService(_deps: CoreDeps): FieldsService {
  return {
    list: async () => notImplemented('fields.list'),
    formSchema: async () => notImplemented('fields.formSchema'),
    dimensions: async () => notImplemented('fields.dimensions'),
    create: async () => notImplemented('fields.create'),
    update: async () => notImplemented('fields.update'),
    reorder: async () => notImplemented('fields.reorder'),
    deactivate: async () => notImplemented('fields.deactivate'),
    reactivate: async () => notImplemented('fields.reactivate'),
    usage: async () => notImplemented('fields.usage'),
    delete: async () => notImplemented('fields.delete'),
    addOption: async () => notImplemented('fields.addOption'),
    updateOption: async () => notImplemented('fields.updateOption'),
    reorderOptions: async () => notImplemented('fields.reorderOptions'),
    deactivateOption: async () => notImplemented('fields.deactivateOption'),
    reactivateOption: async () => notImplemented('fields.reactivateOption'),
    deleteOption: async () => notImplemented('fields.deleteOption'),
    similarOptions: async () => notImplemented('fields.similarOptions'),
    mergeOptions: async () => notImplemented('fields.mergeOptions'),
  };
}
