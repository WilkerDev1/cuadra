import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { isDomainError } from '../../../core';
import { useT } from '../../../i18n';
import { Button, EmptyState } from '../../../ui';
import { StepBar } from '../components/StepBar';
import { TemplatePreviewView } from '../components/TemplatePreviewView';
import { useDraft } from '../draft';
import '../onboarding.css';

/** `/bienvenida/plantilla/:templateId`: todo lo que crearía una plantilla, con un botón para usarla. */
export function Component() {
  const t = useT();
  const cuadra = useCuadra();
  const navigate = useNavigate();
  const { templateId = '' } = useParams();
  const choose = useDraft((s) => s.choose);

  const found = useMemo(() => {
    try {
      return { file: cuadra.templates.get(templateId), preview: cuadra.templates.preview(templateId) };
    } catch (e) {
      if (isDomainError(e)) return null;
      throw e;
    }
  }, [cuadra, templateId]);

  const back = () => void navigate('/bienvenida?paso=plantilla', { viewTransition: true });

  return (
    <div className="onb">
      <div className="onb-page onb-page--preview">
        <StepBar n={0} total={0} onBack={back} hideCount />
        {found === null ? (
          <EmptyState
            message={t('onboarding.preview.notFound')}
            action={
              <Button variant="secondary" onClick={back}>
                {t('onboarding.preview.back')}
              </Button>
            }
          />
        ) : (
          <div className="onb-step">
            <header className="onb-prevhead">
              <h1 className="onb-h1" tabIndex={-1}>
                {found.file.name}
              </h1>
              <p className="onb-side__desc">{found.file.description}</p>
            </header>
            <TemplatePreviewView preview={found.preview} mode="full" />
            <div className="onb-actions">
              <Button
                variant="primary"
                fullWidth
                onClick={() => {
                  choose({ kind: 'bundled', id: found.file.id });
                  void navigate('/bienvenida?paso=plantilla', { viewTransition: true });
                }}
              >
                {t('onboarding.preview.use')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
