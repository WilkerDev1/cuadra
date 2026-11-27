// Ranura del inspector (DESIGN §8.1/§8.3). A partir de 1280 px el detalle va en un panel fijo de 380 px a la derecha
// (no modal); en anchos menores, el mismo contenido sale como hoja (inferior en móvil, lateral desde 600 px).
//
// Las rutas con `presentation: 'sheet'` ya van aquí sin hacer nada (las envuelve el shell). Una feature que quiera
// mostrar detalle SIN cambiar de ruta (por ejemplo, al seleccionar una fila) renderiza el panel mientras esté seleccionado:
//
//   {selected !== null && (
//     <InspectorPanel title={t('ledger.detail')} onClose={() => setSelected(null)}>
//       <TransactionDetail id={selected} />
//     </InspectorPanel>
//   )}
import { X } from 'lucide-react';
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../../i18n';
import { Dialog, IconButton, Sheet } from '../../ui';

export interface InspectorContextValue {
  mode: 'sheet' | 'inspector';
  /** Elemento del shell donde se pinta el panel cuando `mode === 'inspector'`. */
  target: HTMLElement | null;
  /** Reserva la columna del inspector mientras haya un panel; devuelve la función que la libera. */
  claim(): () => void;
}

export const InspectorContext = createContext<InspectorContextValue>({
  mode: 'sheet',
  target: null,
  claim: () => () => undefined,
});

export interface InspectorPanelProps {
  title: ReactNode;
  /** Se llama al pedir cierre (×, Esc en hoja, tocar fuera). El que lo monta debe dejar de renderizarlo. */
  onClose: () => void;
  /** Cambios sin guardar: cerrar pide confirmación. */
  dirty?: boolean;
  /** Altura de la hoja inferior en móvil. Por defecto `tall`. */
  height?: 'half' | 'tall' | 'full';
  headerAction?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
}

/** Contenido del inspector: portal al panel fijo si hay sitio; hoja en caso contrario. */
export function InspectorPanel({ title, onClose, dirty = false, height = 'tall', headerAction, footer, children }: InspectorPanelProps) {
  const { mode, target, claim } = useContext(InspectorContext);
  const inspector = mode === 'inspector' && target !== null;

  useEffect(() => (inspector ? claim() : undefined), [inspector, claim]);

  // Ancho amplio, pero el panel fijo aún no está montado (primer render): esperar en lugar de parpadear como hoja.
  if (mode === 'inspector' && target === null) return null;
  if (!inspector) {
    return (
      <Sheet
        open
        onClose={onClose}
        title={title}
        variant="auto"
        height={height}
        dirty={dirty}
        {...(headerAction === undefined ? {} : { headerAction })}
        {...(footer === undefined ? {} : { footer })}
      >
        {children}
      </Sheet>
    );
  }
  return createPortal(
    <InspectorFrame title={title} onClose={onClose} dirty={dirty} headerAction={headerAction} footer={footer}>
      {children}
    </InspectorFrame>,
    target,
  );
}

function InspectorFrame({ title, onClose, dirty, headerAction, footer, children }: InspectorPanelProps) {
  const t = useT();
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [confirming, setConfirming] = useState(false);

  // Al abrir, el foco pasa al título (como en las hojas); al cerrar vuelve a donde estaba.
  // El panel se hace visible un instante después de montarse (la columna se abre al reclamarla): se enfoca en el
  // fotograma siguiente, cuando el título ya se puede enfocar.
  useEffect(() => {
    const previous = document.activeElement;
    const frame = requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const request = () => {
    if (dirty === true) setConfirming(true);
    else onClose();
  };
  return (
    <section
      className="inspector__panel"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) request();
      }}
    >
      <header className="inspector__bar">
        <h2 id={titleId} ref={titleRef} tabIndex={-1} className="inspector__title">
          {title}
        </h2>
        {headerAction}
        <IconButton label={t('common.inspector.close')} icon={X} onClick={request} />
      </header>
      <div className="inspector__body">{children}</div>
      {footer === undefined ? null : <footer className="inspector__footer">{footer}</footer>}
      <Dialog
        open={confirming}
        variant="destructive"
        title={t('ui.unsaved.title')}
        description={t('ui.unsaved.body')}
        confirmLabel={t('ui.unsaved.discard')}
        cancelLabel={t('ui.unsaved.keep')}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onClose();
        }}
      />
    </section>
  );
}
