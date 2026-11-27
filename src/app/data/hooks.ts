import { useParams } from 'react-router';
import type { Id } from '../../core';

// Hooks de datos compartidos por varias features. Hoy solo existe el que no necesita el núcleo;
// useWorkspace, useAccounts, useFields, useSetting, etc. (sección 5.1) los añade el agente 2E
// cuando exista `Cuadra` completo.

/** Id del espacio de la ruta `/e/:wsId`. Lanza si se usa fuera de esa ruta. */
export function useWorkspaceId(): Id {
  const { wsId } = useParams();
  if (wsId === undefined) throw new Error('useWorkspaceId se usó fuera de /e/:wsId');
  return wsId;
}
