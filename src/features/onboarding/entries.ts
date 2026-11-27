// Plantillas que se ofrecen en la bienvenida: las empaquetadas más la que se importó de un archivo.
import { useMemo } from 'react';
import { useCuadra } from '../../app/data/CuadraProvider';
import type { TemplateFile, TemplatePreview } from '../../core';
import { useDraft, type TemplateChoice } from './draft';
import { summarizeTemplate, type TemplateSummary } from './logic';

export interface TemplateEntry {
  /** Clave estable para React y para los ids de los controles. */
  key: string;
  choice: TemplateChoice;
  file: TemplateFile;
  preview: TemplatePreview;
  summary: TemplateSummary;
  imported: boolean;
}

export function choiceKey(choice: TemplateChoice): string {
  return choice.kind === 'bundled' ? `b-${choice.id}` : 'file';
}

export function useTemplateEntries(): TemplateEntry[] {
  const cuadra = useCuadra();
  const imported = useDraft((s) => s.imported);
  return useMemo(() => {
    const bundled: TemplateEntry[] = cuadra.templates.list().map((file) => {
      const choice: TemplateChoice = { kind: 'bundled', id: file.id };
      const preview = cuadra.templates.preview(file.id);
      return { key: choiceKey(choice), choice, file, preview, summary: summarizeTemplate(preview), imported: false };
    });
    if (imported === null) return bundled;
    const choice: TemplateChoice = { kind: 'file', file: imported };
    const preview = cuadra.templates.preview(imported);
    return [...bundled, { key: choiceKey(choice), choice, file: imported, preview, summary: summarizeTemplate(preview), imported: true }];
  }, [cuadra, imported]);
}

/** La entrada elegida en el borrador, o `undefined` si todavía no hay ninguna. */
export function selectedEntry(entries: readonly TemplateEntry[], choice: TemplateChoice | null): TemplateEntry | undefined {
  if (choice === null) return undefined;
  const key = choiceKey(choice);
  return entries.find((e) => e.key === key);
}
