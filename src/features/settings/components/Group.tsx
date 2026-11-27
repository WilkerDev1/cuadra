import { useId, type ReactNode } from 'react';

/** Etiqueta + control que no es un `<input>` (segmentado, selector de tinta): grupo con nombre accesible. */
export function Group({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div className="ui-field" role="group" aria-labelledby={id}>
      <div className="ui-field__head">
        <span id={id} className="ui-field__label">
          {label}
        </span>
        {aside === undefined ? null : <span className="ui-field__aside">{aside}</span>}
      </div>
      {children}
    </div>
  );
}
