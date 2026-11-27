// Las rutas de detalle (/e/:wsId/movimientos/:id, /e/:wsId/lotes/:id) reciben ids sueltos: un enlace viejo o
// pegado puede ser de otro espacio. Solo se muestra (y se deja editar o anular) lo que es del espacio de la ruta.
import type { Id } from '../../../core';

export function belongsTo(entity: { workspaceId: Id }, workspaceId: Id): boolean {
  return entity.workspaceId === workspaceId;
}
