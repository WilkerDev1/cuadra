import { useCuadraQuery } from '../../app/data/useCuadraQuery';
import { TX_TABLES } from '../../app/data/queryDefs';
import type { Id, ReportRecipe } from '../../core';

/** Informe armado por el núcleo; se rearma solo cuando cambian los movimientos, cuentas o campos. */
export function useReportDoc(workspaceId: Id, recipe: ReportRecipe | null) {
  return useCuadraQuery({
    key: ['reports.build', workspaceId, recipe],
    tables: [...TX_TABLES, 'workspaces'],
    fn: (c) => {
      if (recipe === null) throw new Error('sin receta');
      return c.reports.build(workspaceId, recipe);
    },
    enabled: recipe !== null,
    keepPrevious: true,
  });
}
