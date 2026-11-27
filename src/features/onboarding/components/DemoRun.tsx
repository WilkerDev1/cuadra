import { Banner, Button, Stamp } from '../../../ui';
import { useT } from '../../../i18n';
import type { DemoPhase } from '../logic';

export interface DemoState {
  /** 0–100, solo sube. */
  percent: number;
  phase: DemoPhase;
  /** Nombre del perfil que se está creando (Colmado La Esquina…). */
  profileName: string;
  failed: string | null;
}

/** Barra de progreso real de `demo.seedAll`: porcentaje, fase y perfil en curso. Al terminar, el sello. */
export function DemoRun({ state, onRetry, onBack }: { state: DemoState; onRetry: () => void; onBack: () => void }) {
  const t = useT();
  const done = state.phase === 'done' && state.failed === null;
  return (
    <section className="onb-run" aria-labelledby="onb-run-h">
      <h1 id="onb-run-h" className="onb-run__h1" tabIndex={-1}>
        {t('onboarding.demo.title')}
      </h1>
      {state.failed !== null ? (
        <>
          <Banner tone="warn" action={<Button variant="secondary" onClick={onRetry}>{t('onboarding.demo.retry')}</Button>}>
            {t('onboarding.demo.error')}
          </Banner>
          <Button variant="ghost" onClick={onBack}>
            {t('onboarding.demo.cancel')}
          </Button>
        </>
      ) : done ? (
        <div className="onb-run__done" role="status">
          <Stamp animate size="5rem" label={t('onboarding.demo.done')} />
          <p className="onb-run__phase">{t('onboarding.demo.done')}</p>
        </div>
      ) : (
        <>
          <p className="onb-run__percent num" data-amount aria-hidden="true">
            <span className="onb-run__figure">{state.percent}</span>
            <span className="onb-run__unit">%</span>
          </p>
          <progress className="onb-progress" max={100} value={state.percent} aria-label={t('onboarding.demo.progress')} />
          <p className="onb-run__phase" role="status">
            {t(`onboarding.demo.phase.${state.phase}`)}
          </p>
          {state.profileName === '' ? null : <p className="onb-run__profile">{state.profileName}</p>}
        </>
      )}
    </section>
  );
}
