// Borrador de la bienvenida: vive en memoria mientras dura la sesión para que ir a la vista previa de una
// plantilla y volver no pierda lo escrito. No toca la base: nada se guarda hasta «Crear espacio».
import { create } from 'zustand';
import type { TemplateFile } from '../../core';
import { DEFAULT_CURRENCY_CODE, withOpening, type OpeningEntry, type OpeningMap } from './logic';

export type TemplateChoice = { kind: 'bundled'; id: string } | { kind: 'file'; file: TemplateFile };

interface DraftState {
  choice: TemplateChoice | null;
  /** Plantilla leída de un archivo (se ofrece junto a las empaquetadas aunque se elija otra). */
  imported: TemplateFile | null;
  name: string;
  currencyCode: string;
  openings: OpeningMap;
  choose(choice: TemplateChoice): void;
  setImported(file: TemplateFile): void;
  setName(name: string): void;
  setCurrency(code: string): void;
  setOpening(accountKey: string, entry: OpeningEntry | null): void;
  reset(): void;
}

const empty = { choice: null, imported: null, name: '', currencyCode: DEFAULT_CURRENCY_CODE, openings: {} } as const;

export const useDraft = create<DraftState>()((set) => ({
  ...empty,
  // Otra plantilla trae otras cuentas: los saldos puestos ya no valen.
  choose: (choice) => set((s) => (sameChoice(s.choice, choice) ? s : { choice, openings: {} })),
  setImported: (file) => set({ imported: file, choice: { kind: 'file', file }, openings: {} }),
  setName: (name) => set({ name }),
  setCurrency: (currencyCode) => set({ currencyCode }),
  setOpening: (key, entry) => set((s) => ({ openings: withOpening(s.openings, key, entry) })),
  reset: () => set({ ...empty }),
}));

function sameChoice(a: TemplateChoice | null, b: TemplateChoice): boolean {
  if (a === null || a.kind !== b.kind) return false;
  return a.kind === 'bundled' ? a.id === (b as { id: string }).id : a.file === (b as { file: TemplateFile }).file;
}
