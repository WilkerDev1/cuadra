import { FileJson, FolderOpen } from 'lucide-react';
import { useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { errorMessage } from '../../../app/data/errorMessage';
import { useUiStore } from '../../../app/state/uiStore';
import type { TemplateFile, TemplateIssue, TemplatePreview } from '../../../core';
import { useT } from '../../../i18n';
import { Banner, Button, Card, EmptyState, Field, Input, Stamp } from '../../../ui';
import { MAX_TEMPLATE_BYTES } from '../logic';

type View =
  | { kind: 'idle' }
  | { kind: 'reading'; name: string }
  | { kind: 'invalid'; name: string; issues: TemplateIssue[] }
  | { kind: 'ready'; fileName: string; file: TemplateFile; preview: TemplatePreview }
  | { kind: 'created'; wsId: string; name: string };

/** Importar una plantilla desde archivo: validación, vista previa y creación de un espacio nuevo. */
export function TemplateImport() {
  const t = useT();
  const cuadra = useCuadra();
  const toast = useUiStore((s) => s.pushToast);
  const ids = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState(false);
  const [busy, setBusy] = useState(false);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file === undefined) return;
    setView({ kind: 'reading', name: file.name });
    if (file.size > MAX_TEMPLATE_BYTES) {
      setView({ kind: 'invalid', name: file.name, issues: [{ path: '$', message: t('errors.template_invalid') }] });
      return;
    }
    try {
      const result = cuadra.templates.parse(await file.text());
      if (!result.ok) {
        setView({ kind: 'invalid', name: file.name, issues: result.issues });
        return;
      }
      setName(result.value.name);
      setNameError(false);
      setView({ kind: 'ready', fileName: file.name, file: result.value, preview: cuadra.templates.preview(result.value) });
    } catch (error) {
      setView({ kind: 'invalid', name: file.name, issues: [{ path: '$', message: errorMessage(error, t) }] });
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (view.kind !== 'ready' || busy) return;
    if (name.trim() === '') {
      setNameError(true);
      return;
    }
    setBusy(true);
    try {
      const out = await cuadra.templates.apply(view.file, { name: name.trim() });
      setView({ kind: 'created', wsId: out.value.id, name: out.value.name });
      toast({ message: 'backup.tpl.created', params: { name: out.value.name } });
    } catch (error) {
      toast({ message: 'common.error.toast', params: { message: errorMessage(error, t) }, tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  const pick = (label: string, ghost = false) => (
    <Button variant={ghost ? 'ghost' : 'secondary'} icon={FolderOpen} onClick={() => picker.current?.click()}>
      {label}
    </Button>
  );

  return (
    <Card as="section" aria-labelledby={`${ids}-h`} className="bk-card">
      <h2 id={`${ids}-h`} className="bk-h2">
        {t('backup.tpl.import')}
      </h2>
      <input
        ref={picker}
        type="file"
        className="visually-hidden"
        accept=".json,.cuadra-plantilla,application/json"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="template-file"
        onChange={(e) => void onFile(e)}
      />

      {view.kind === 'idle' ? <EmptyState message={t('backup.tpl.importEmpty')} rows={3} action={pick(t('backup.tpl.pick'))} /> : null}
      {view.kind === 'reading' ? (
        <p className="bk-note" role="status">
          {t('backup.tpl.reading')}
        </p>
      ) : null}

      {view.kind === 'invalid' ? (
        <div className="bk-stack">
          <Banner tone="warn" title={t('backup.tpl.invalid')}>
            <ul className="bk-issues">
              {view.issues.slice(0, 8).map((issue, i) => (
                <li key={`${issue.path}-${i}`}>
                  <code>{issue.path}</code> {issue.message}
                </li>
              ))}
            </ul>
          </Banner>
          <div>{pick(t('backup.tpl.pickAnother'))}</div>
        </div>
      ) : null}

      {view.kind === 'ready' ? (
        <form className="bk-stack" onSubmit={(e) => void create(e)} noValidate>
          <p className="bk-file">
            <FileJson aria-hidden="true" /> <span className="bk-file__name">{view.fileName}</span>
          </p>
          {view.preview.description === '' ? null : <p className="bk-note">{view.preview.description}</p>}
          <p className="bk-summary" data-testid="template-counts">
            {t('backup.tpl.counts', { acc: view.preview.accounts.length, fields: view.preview.fields.length, views: view.preview.views.length })}
          </p>
          <PreviewLists preview={view.preview} />
          <Field label={t('backup.tpl.name')} error={nameError ? t('backup.tpl.nameRequired') : undefined} help={view.preview.currency === null ? undefined : t('backup.tpl.currency', { code: view.preview.currency.code })}>
            <Input
              value={name}
              maxLength={60}
              autoComplete="off"
              onChange={(e) => {
                setName(e.target.value);
                setNameError(false);
              }}
            />
          </Field>
          <div className="bk-actions">
            <Button type="submit" variant="primary" loading={busy}>
              {busy ? t('backup.tpl.creating') : t('backup.tpl.create')}
            </Button>
            {pick(t('backup.tpl.pickAnother'), true)}
          </div>
        </form>
      ) : null}

      {view.kind === 'created' ? (
        <div className="bk-done" role="status">
          <Stamp animate size="3.5rem" />
          <div className="bk-done__text">
            <p className="bk-done__title">{t('backup.tpl.created', { name: view.name })}</p>
            <div className="bk-actions">
              <Link className="bk-linkbtn" to={`/e/${view.wsId}`}>
                {t('backup.tpl.open')}
              </Link>
              {pick(t('backup.tpl.pickAnother'), true)}
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

function PreviewLists({ preview }: { preview: TemplatePreview }) {
  const t = useT();
  const groups = [
    {
      id: 'accounts',
      title: t('backup.tpl.accounts'),
      count: preview.accounts.length,
      items: preview.accounts.map((a) => ({ key: a.key, label: a.name, meta: t(`backup.tpl.type.${a.type}`) })),
    },
    {
      id: 'fields',
      title: t('backup.tpl.fields'),
      count: preview.fields.length,
      items: preview.fields.map((f) => ({
        key: f.key,
        label: f.label,
        meta: f.options.length > 0 ? `${t(`backup.tpl.fieldType.${f.type}`)} · ${t('backup.tpl.options', { n: f.options.length })}` : t(`backup.tpl.fieldType.${f.type}`),
      })),
    },
    {
      id: 'views',
      title: t('backup.tpl.views'),
      count: preview.views.length,
      items: preview.views.map((v) => ({ key: v.key, label: v.name, meta: t(`backup.tpl.viewKind.${v.kind}`) })),
    },
  ];
  return (
    <div className="bk-lists">
      {groups.map((g) => (
        <details key={g.id} className="bk-details" open={g.id === 'accounts'}>
          <summary>
            <span>{g.title}</span>
            <span className="bk-details__n num">{g.count}</span>
          </summary>
          {g.items.length === 0 ? (
            <p className="bk-note">{t('backup.tpl.noItems')}</p>
          ) : (
            <ul role="list" className="bk-detaillist">
              {g.items.map((item) => (
                <li key={item.key}>
                  <span>{item.label}</span>
                  <span className="bk-detaillist__meta">{item.meta}</span>
                </li>
              ))}
            </ul>
          )}
        </details>
      ))}
    </div>
  );
}
