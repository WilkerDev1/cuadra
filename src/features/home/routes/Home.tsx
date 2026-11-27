// Ruta índice del espacio (/e/:wsId). Escritorio (≥ 1024 px de shell, DESIGN §8.1) → panel; si no, inicio móvil.
// Se elige en JS porque cambia la estructura y la consulta, no solo el estilo.
import { atLeast, useBreakpoint } from '../../../app/state/breakpoint';
import { Desktop } from '../components/Desktop';
import { Mobile } from '../components/Mobile';
import '../home.css';

export function Component() {
  const desktop = atLeast(useBreakpoint(), 'expanded');
  return desktop ? <Desktop /> : <Mobile />;
}
