import { ChevronDown, CircleAlert, FileUp, Sparkles } from 'lucide-react';
import { useRef, useState, type CSSProperties } from 'react';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { useT } from '../../../i18n';
import { Banner, Button, Card, Chip, Field, Input, Select } from '../../../ui';
import { workspaceTint } from '../tint';
import { useDraft } from '../draft';
import { selectedEntry, type TemplateEntry } from '../entries';
import {
  CURRENCIES,
  currencyLabel,
  describeIssues,
  nameProblem,
  templateFileProblem,
  type CurrencyOption,
} from '../logic';
import { TemplatePreviewView } from './TemplatePreviewView';

/** Tras abrir un lomo, lo deja a la vista cuando termina de desplegarse (la barra de abajo no lo tapa). */
function keepInView(el: Element | null): void {
  if (el === null) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.setTimeout(() => el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }), 340);
}

const OPTIONS = CURRENCIES.map((c: CurrencyOption) => ({ value: c.code, label: currencyLabel(c) }));

function Summary({ entry }: { entry: TemplateEntry }) {
  const t = useT();
  const s = entry.summary;
  const parts = [
    t('onboarding.template.sum.accounts', { n: s.accounts }),
    s.categories > 0 ? t('onboarding.template.sum.categories', { n: s.categories }) : t('onboarding.template.sum.noCategories'),
    ...(s.otherFields > 0 ? [t('onboarding.template.sum.fields', { n: s.otherFields })] : []),
  ];
  return <>{parts.join(' · ')}</>;
}

/** Paso 2: nombre, moneda y plantilla (lomos con su vista previa real). */
export function TemplateStep({
  entries,
  showDemo,
  onContinue,
  onDemo,
}: {
  entries: readonly TemplateEntry[];
  showDemo: boolean;
  onContinue: () => void;
  onDemo: () => void;
}) {
  const t = useT();
  const cuadra = useCuadra();
  const { choice, name, currencyCode, choose, setName, setCurrency, setImported } = useDraft();
  const [touched, setTouched] = useState(false);
  const [pickMissing, setPickMissing] = useState(false);
  const [importIssues, setImportIssues] = useState<{ title: string; lines: string[]; more: number } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = selectedEntry(entries, choice);
  const problem = nameProblem(name);
  const nameError =
    touched && problem !== null ? t(problem === 'empty' ? 'onboarding.template.nameEmpty' : 'onboarding.template.nameLong') : undefined;

  const submit = () => {
    setTouched(true);
    if (problem !== null) {
      nameRef.current?.focus();
      return;
    }
    if (selected === undefined) {
      setPickMissing(true);
      return;
    }
    onContinue();
  };

  const readFile = async (file: File) => {
    setImportIssues(null);
    const bad = templateFileProblem(file);
    if (bad !== null) {
      setImportIssues({ title: t('onboarding.template.importInvalid'), lines: [], more: 0 });
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setImportIssues({ title: t('onboarding.template.importRead'), lines: [], more: 0 });
      return;
    }
    const result = cuadra.templates.parse(text);
    if (result.ok) {
      setImported(result.value);
      return;
    }
    const { lines, more } = describeIssues(result.issues);
    setImportIssues({ title: t('onboarding.template.importInvalid'), lines, more });
  };

  return (
    <form
      className="onb-step"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      noValidate
    >
      <h1 className="visually-hidden" tabIndex={-1}>
        {t('onboarding.newSpace')}
      </h1>
      <div className="onb-split">
        <div className="onb-split__main">
          <div className="onb-ident">
            <Field label={t('onboarding.template.name')} error={nameError}>
              <Input
                ref={nameRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name.trim() !== '' && setTouched(true)}
                placeholder={t('onboarding.template.namePlaceholder')}
                autoComplete="off"
                enterKeyHint="next"
                invalid={nameError !== undefined}
                aria-required="true"
              />
            </Field>
            <Field label={t('onboarding.template.currency')}>
              <Select options={OPTIONS} value={currencyCode} onChange={setCurrency} />
            </Field>
          </div>

          <fieldset className="onb-lomos">
            <legend className="onb-h2">{t('onboarding.template.pick')}</legend>
            {pickMissing ? (
              <p className="onb-pick-error" role="alert">
                <CircleAlert aria-hidden="true" />
                {t('onboarding.template.pickFirst')}
              </p>
            ) : null}
            {entries.map((entry) => {
              const isSel = selected?.key === entry.key;
              const tint = workspaceTint(entry.file.color ?? 'tint-8', entry.file.id);
              return (
                <div key={entry.key} className="onb-lomo" data-selected={isSel || undefined} style={{ '--spine': tint } as CSSProperties}>
                  <label className="onb-lomo__head">
                    <input
                      type="radio"
                      name="plantilla"
                      className="visually-hidden"
                      checked={isSel}
                      onChange={(e) => {
                        choose(entry.choice);
                        setPickMissing(false);
                        keepInView(e.currentTarget.closest('.onb-lomo'));
                      }}
                    />
                    <span className="onb-lomo__text">
                      <span className="onb-lomo__name">
                        {entry.file.name}
                        {entry.imported ? <Chip variant="info">{t('onboarding.template.file')}</Chip> : null}
                      </span>
                      <span className="onb-lomo__sum">
                        <Summary entry={entry} />
                      </span>
                    </span>
                    <ChevronDown className="onb-lomo__chev" aria-hidden="true" />
                  </label>
                  <div className="onb-lomo__panel" inert={!isSel}>
                    <div className="onb-lomo__panel-in">
                      <TemplatePreviewView
                        preview={entry.preview}
                        mode="compact"
                        {...(entry.choice.kind === 'bundled' ? { seeAllTo: `/bienvenida/plantilla/${entry.choice.id}` } : {})}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </fieldset>

          {importIssues === null ? null : (
            <Banner tone="warn" title={importIssues.title}>
              {importIssues.lines.length === 0 ? null : (
                <ul className="onb-issues" role="list">
                  {importIssues.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                  {importIssues.more > 0 ? <li>{t('onboarding.template.issueMore', { n: importIssues.more })}</li> : null}
                </ul>
              )}
            </Banner>
          )}

          <div className="onb-extra">
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file !== undefined) void readFile(file);
              }}
            />
            <Button variant="ghost" icon={FileUp} onClick={() => fileRef.current?.click()}>
              {t('onboarding.template.import')}
            </Button>
            {showDemo ? (
              <Button variant="ghost" icon={Sparkles} onClick={onDemo}>
                {t('onboarding.template.demo')}
              </Button>
            ) : null}
          </div>
        </div>

        <aside className="onb-split__side" aria-label={selected?.file.name}>
          {selected === undefined ? null : (
            <Card className="onb-side">
              <h2 className="onb-side__name">{selected.file.name}</h2>
              <p className="onb-side__desc">{selected.file.description}</p>
              <TemplatePreviewView preview={selected.preview} mode="full" />
            </Card>
          )}
        </aside>
      </div>

      <div className="onb-actions">
        <Button variant="primary" type="submit" fullWidth>
          {t('onboarding.continue')}
        </Button>
      </div>
    </form>
  );
}

