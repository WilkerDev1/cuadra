// Fecha con su etiqueta asociada: `Field` pone el `<label for>` y el id (DateField lo toma del contexto), así el
// lector de pantalla anuncia «Fecha, 27/11/2026» y no solo «fecha». Mismo aspecto que los demás campos.
import { DateField, Field, type DateFieldProps } from '../../../ui';

export function DateGroup({ label, ...props }: Omit<DateFieldProps, 'id'> & { label: string }) {
  return (
    <Field label={label}>
      <DateField {...props} />
    </Field>
  );
}
