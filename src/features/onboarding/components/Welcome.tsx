import { HardDrive } from 'lucide-react';
import { Link } from 'react-router';
import { useT } from '../../../i18n';
import { Button, DoubleRule } from '../../../ui';
import { Wordmark } from './Wordmark';

/** Paso 1: la marca, el aviso honesto y la salida a empezar, a los ejemplos o a un respaldo. */
export function Welcome({ onStart, onDemo, showDemo }: { onStart: () => void; onDemo: () => void; showDemo: boolean }) {
  const t = useT();
  return (
    <section className="onb-welcome" aria-labelledby="onb-welcome-h">
      {/* Papel de libro: la marca se escribe al pie de una hoja rayada con sus columnas (como la pantalla de bloqueo) */}
      <div className="onb-paper" aria-hidden="true">
        <span>{t('onboarding.paper.date')}</span>
        <span>{t('onboarding.paper.concept')}</span>
        <span className="onb-paper__num">{t('onboarding.paper.in')}</span>
        <span className="onb-paper__num">{t('onboarding.paper.out')}</span>
        <span className="onb-paper__num">{t('onboarding.paper.balance')}</span>
      </div>
      <div className="onb-welcome__hero">
        <h1 id="onb-welcome-h" className="onb-welcome__h1" tabIndex={-1}>
          <Wordmark />
        </h1>
        <DoubleRule variant="double" animate animateKey="welcome" />
        <p className="onb-tagline">{t('onboarding.welcome.tagline')}</p>
      </div>
      <div className="onb-welcome__foot">
        <p className="onb-notice">
          <HardDrive aria-hidden="true" />
          <span>{t('onboarding.welcome.local')}</span>
        </p>
        <div className="onb-welcome__actions">
          <Button variant="primary" fullWidth onClick={onStart}>
            {t('onboarding.welcome.start')}
          </Button>
          <div className="onb-welcome__links">
            {showDemo ? (
              <Button variant="ghost" onClick={onDemo}>
                {t('onboarding.welcome.demo')}
              </Button>
            ) : null}
            <Link to="/respaldo" className="onb-link">
              {t('onboarding.welcome.restore')}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
