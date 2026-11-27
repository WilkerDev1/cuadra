import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { errorMessage } from '../../../app/data/errorMessage';
import { useWorkspaces } from '../../../app/data/hooks';
import { useCuadraMutation } from '../../../app/data/useCuadraMutation';
import { systemClock, type Id } from '../../../core';
import { useT } from '../../../i18n';
import { Banner, Button, Skeleton } from '../../../ui';
import { Created } from '../components/Created';
import { DemoRun, type DemoState } from '../components/DemoRun';
import { OpeningStep } from '../components/OpeningStep';
import { StepBar } from '../components/StepBar';
import { TemplateStep } from '../components/TemplateStep';
import { Welcome } from '../components/Welcome';
import { useDraft } from '../draft';
import { selectedEntry, useTemplateEntries } from '../entries';
import {
  advanceProgress,
  buildApplyInput,
  currencyByCode,
  guardStep,
  nameProblem,
  nextStep,
  previousStep,
  resolveStep,
  stepPosition,
  type Step,
} from '../logic';
import '../onboarding.css';

type Phase = { kind: 'steps' } | { kind: 'demo' } | { kind: 'created'; id: Id; name: string };

const FIRST_TEMPLATE = 'negocio';
/** Desde aquí la vista previa de la plantilla va en un panel aparte (el CSS usa el mismo corte en rem). */
const WIDE_QUERY = '(min-width: 60rem)';

function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** `/bienvenida`: sirve para la primera vez y para «Nuevo espacio» desde el selector. */
export function Component() {
  const t = useT();
  const cuadra = useCuadra();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const list = useWorkspaces({ includeArchived: true });
  const entries = useTemplateEntries();
  const draft = useDraft();
  const [phase, setPhase] = useState<Phase>({ kind: 'steps' });
  const [demo, setDemo] = useState<DemoState>({ percent: 0, phase: 'structure', profileName: '', failed: null });
  const [createError, setCreateError] = useState<string | null>(null);
  const mounted = useRef(true);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const hasWorkspaces = (list.data?.length ?? 0) > 0;
  const hasDemo = list.data?.some((w) => w.isDemo) ?? false;
  const asked = params.get('paso');
  const step: Step = guardStep(resolveStep(asked, hasWorkspaces), draft.choice !== null);
  const selected = selectedEntry(entries, draft.choice);

  // En ancho hay un panel de vista previa al lado: arranca con la primera plantilla (Negocio pequeño) para que
  // ya muestre algo real. En el móvil los cinco lomos se ven cerrados y la persona elige.
  const wide = useMatchMedia(WIDE_QUERY);
  useEffect(() => {
    if (wide && draft.choice === null) {
      const first = entries.find((e) => e.choice.kind === 'bundled' && e.choice.id === FIRST_TEMPLATE) ?? entries[0];
      if (first !== undefined) draft.choose(first.choice);
    }
  }, [wide, entries, draft.choice]);

  // Al cambiar de paso el foco pasa al título de la vista nueva (DESIGN §12); la primera carga no lo roba.
  const lastStep = useRef<string | null>(null);
  useEffect(() => {
    const key = phase.kind === 'steps' ? step : phase.kind;
    const first = lastStep.current === null;
    lastStep.current = key;
    if (first) return;
    window.scrollTo({ top: 0 });
    const id = requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [step, phase.kind]);

  const go = (to: Step, replace = false) => setParams({ paso: to }, { replace, viewTransition: true });
  const leave = () => {
    draft.reset();
    void navigate('/', { viewTransition: true });
  };

  const finish = (id: Id, name: string) => {
    draft.reset();
    setPhase({ kind: 'created', id, name });
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(() => {
      if (mounted.current) void navigate(`/e/${id}`, { replace: true, viewTransition: true });
    }, reduce ? 500 : 1100);
  };

  // ── Crear el espacio ──────────────────────────────────────────────────────────────────
  const create = useCuadraMutation(
    (c, input: { source: Parameters<typeof c.templates.apply>[0]; payload: Parameters<typeof c.templates.apply>[1] }) =>
      c.templates.apply(input.source, input.payload),
    { errorToast: false },
  );
  const createSpace = async () => {
    if (selected === undefined) return;
    setCreateError(null);
    const payload = buildApplyInput(
      { name: draft.name, currencyCode: draft.currencyCode, openings: draft.openings },
      selected.preview.accounts.map((a) => a.key),
      systemClock.today(),
    );
    try {
      const res = await create.mutateAsync({ source: selected.choice.kind === 'bundled' ? selected.choice.id : selected.choice.file, payload });
      finish(res.value.id, res.value.name);
    } catch (e) {
      setCreateError(errorMessage(e, t));
    }
  };

  // ── Datos de ejemplo ──────────────────────────────────────────────────────────────────
  const runDemo = async () => {
    setPhase({ kind: 'demo' });
    setDemo({ percent: 0, phase: 'structure', profileName: '', failed: null });
    const profiles = cuadra.demo.profiles();
    try {
      const results = await cuadra.demo.seedAll({
        onProgress: (p) => {
          if (!mounted.current) return;
          setDemo((d) => ({
            percent: advanceProgress(d.percent, p.fraction),
            phase: p.phase,
            profileName: profiles.find((x) => x.id === p.profile)?.name ?? d.profileName,
            failed: null,
          }));
        },
      });
      void cuadra.settings.set('demo.offered', true).catch(() => undefined);
      const first = results[0]?.value.workspace;
      if (!mounted.current) return;
      setDemo((d) => ({ ...d, percent: 100, phase: 'done' }));
      if (first === undefined) {
        void navigate('/', { replace: true });
        return;
      }
      draft.reset();
      window.setTimeout(() => {
        if (mounted.current) void navigate(`/e/${first.id}`, { replace: true, viewTransition: true });
      }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 500 : 1200);
    } catch (e) {
      if (mounted.current) setDemo((d) => ({ ...d, failed: errorMessage(e, t) }));
    }
  };

  // ── Qué se ve ─────────────────────────────────────────────────────────────────────────
  if (list.isError) {
    return (
      <div className="onb" ref={rootRef}>
        <div className="onb-page">
          <Banner tone="warn" action={<Button variant="secondary" onClick={() => void list.refetch()}>{t('workspaces.retry')}</Button>}>
            {t('workspaces.error')}
          </Banner>
        </div>
      </div>
    );
  }
  if (list.data === undefined) {
    return (
      <div className="onb" ref={rootRef}>
        <div className="onb-page">
          <Skeleton label={t('workspaces.loading')} />
        </div>
      </div>
    );
  }

  if (phase.kind === 'created') {
    return (
      <div className="onb" ref={rootRef}>
        <div className="onb-page onb-page--center">
          <Created name={phase.name} />
        </div>
      </div>
    );
  }
  if (phase.kind === 'demo') {
    return (
      <div className="onb" ref={rootRef}>
        <div className="onb-page onb-page--center">
          <DemoRun
            state={demo}
            onRetry={() => void runDemo()}
            onBack={() => {
              setPhase({ kind: 'steps' });
            }}
          />
        </div>
      </div>
    );
  }

  const { n, total } = stepPosition(step, hasWorkspaces);
  const back = previousStep(step, hasWorkspaces);

  return (
    <div className="onb" ref={rootRef}>
      <div className={`onb-page onb-page--${step}`}>
        {step === 'inicio' ? null : <StepBar n={n} total={total} onBack={() => (back === null ? leave() : go(back))} />}
        {step === 'inicio' ? (
          <Welcome
            onStart={() => {
              void cuadra.settings.set('disclaimer.acceptedAt', systemClock.now().toISOString()).catch(() => undefined);
              go('plantilla');
            }} onDemo={() => void runDemo()} showDemo={!hasDemo} />
        ) : null}
        {step === 'plantilla' ? (
          <TemplateStep
            entries={entries}
            showDemo={!hasDemo}
            onDemo={() => void runDemo()}
            onContinue={() => {
              if (nameProblem(draft.name) === null) go(nextStep(step, hasWorkspaces) ?? 'saldos');
            }}
          />
        ) : null}
        {step === 'saldos' && selected !== undefined ? (
          <OpeningStep
            entry={selected}
            currency={currencyByCode(draft.currencyCode)}
            creating={create.isPending}
            error={createError}
            onCreate={() => void createSpace()}
          />
        ) : null}
      </div>
    </div>
  );
}
