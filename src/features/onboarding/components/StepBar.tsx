import { ArrowLeft } from 'lucide-react';
import { IconButton } from '../../../ui';
import { useT } from '../../../i18n';

/** Barra de los pasos 2 y 3: Atrás a la izquierda y «2 de 3» en texto (sin puntos). */
export function StepBar({ n, total, onBack, hideCount = false }: { n: number; total: number; onBack: () => void; hideCount?: boolean }) {
  const t = useT();
  return (
    <div className="onb-bar">
      <IconButton variant="ghost" icon={ArrowLeft} label={t('onboarding.back')} onClick={onBack} />
      {hideCount ? null : (
        <p className="onb-bar__step" aria-label={t('onboarding.step', { n, total })}>
          {t('onboarding.step', { n, total })}
        </p>
      )}
    </div>
  );
}
