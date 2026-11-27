// ↑ ↓ para reordenar (alternativa visible al arrastre, DESIGN §10.13) y el aviso para lectores de pantalla.
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import { useT } from '../../../i18n';
import { Button, IconButton } from '../../../ui';

export function ReorderButtons({
  name,
  canUp,
  canDown,
  onMove,
}: {
  name: string;
  canUp: boolean;
  canDown: boolean;
  onMove: (delta: -1 | 1) => void;
}) {
  const t = useT('settings');
  return (
    <span className="set-reorder">
      <IconButton label={t('moveUp', { name })} icon={ChevronUp} disabled={!canUp} onClick={() => onMove(-1)} />
      <IconButton label={t('moveDown', { name })} icon={ChevronDown} disabled={!canDown} onClick={() => onMove(1)} />
    </span>
  );
}

/** Región `aria-live` educada: «“Caja” ahora es 2.º de 5». */
export function useAnnouncer(): [node: ReactNode, announce: (text: string) => void] {
  const [text, setText] = useState('');
  const announce = useCallback((next: string) => {
    setText('');
    // Un instante vacío para que repetir el mismo texto se vuelva a leer.
    setTimeout(() => setText(next), 30);
  }, []);
  const node = (
    <p className="visually-hidden" role="status" aria-live="polite">
      {text}
    </p>
  );
  return [node, announce];
}

/** En pantallas estrechas ↑ ↓ se esconden y este botón los muestra: la fila conserva el ancho para el nombre. */
export function OrderToggle({ ordering, onToggle }: { ordering: boolean; onToggle: () => void }) {
  const t = useT('settings');
  return (
    <div className="set-ordertoggle">
      <Button variant="secondary" aria-pressed={ordering} onClick={onToggle}>
        {ordering ? t('orderDone') : t('order')}
      </Button>
    </div>
  );
}
