import { Stamp } from '../../../ui';
import { useT } from '../../../i18n';

/** Fin del recorrido: el sello de cuadre se dibuja en el centro y la vista pasa al espacio nuevo. */
export function Created({ name }: { name: string }) {
  const t = useT();
  return (
    <section className="onb-run onb-run--created" role="status" aria-live="polite">
      <Stamp animate size="6rem" label={t('onboarding.done')} />
      <h1 className="onb-run__done-h" tabIndex={-1}>
        {t('onboarding.done')}
      </h1>
      <p className="onb-run__profile">{name}</p>
    </section>
  );
}
