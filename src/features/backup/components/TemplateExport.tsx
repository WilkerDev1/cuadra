import { Download } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { useWorkspaces } from '../../../app/data/hooks';
import { errorMessage } from '../../../app/data/errorMessage';
import { useCuadraQuery } from '../../../app/data/useCuadraQuery';
import { useUiStore } from '../../../app/state/uiStore';
import { useT } from '../../../i18n';
import { Banner, Button, Card, EmptyState, Field, InfoTip, Input, Select, Switch, Textarea } from '../../../ui';
import { saveTextFile } from '../files';
import { includeCount, normalizeInclude, pruneTemplate, viewsAvailable, type TemplateInclude } from '../logic';
import { LoadError } from './Page';

/** «Guardar este espacio como plantilla»: estructura sin movimientos ni saldos, con lo que se elija incluir. */
export function TemplateExport({ workspaceId, title }: { workspaceId?: string; title: string }) {
  const t = useT();
  const cuadra = useCuadra();
  const toast = useUiStore((s) => s.pushToast);
  const ids = useId();
  const workspaces = useWorkspaces();
  const list = workspaces.data ?? [];
  const [picked, setPicked] = useState('');
  const wsId = workspaceId ?? picked;

  useEffect(() => {
    if (workspaceId !== undefined) return;
    if (picked === '' || !list.some((w) => w.id === picked)) setPicked(list[0]?.id ?? '');
  }, [list, picked, workspaceId]);

  const exported = useCuadraQuery({
    key: ['templates.export', wsId],
    tables: ['workspaces', 'accounts', 'fields', 'field_options', 'saved_views'],
    fn: (c) => c.templates.exportFromWorkspace(wsId),
    enabled: wsId !== '',
  });
  const base = exported.data;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [include, setInclude] = useState<TemplateInclude>({ accounts: true, fields: true, views: true });
  const [busy, setBusy] = useState(false);

  // Al cambiar de espacio se parte de su nombre.
  const baseName = base?.name;
  useEffect(() => {
    if (baseName !== undefined) {
      setName(baseName);
      setDescription('');
    }
  }, [baseName, wsId]);

  const inc = normalizeInclude(include);
  const pruned = useMemo(() => (base === undefined ? null : pruneTemplate(base, inc, { name, description })), [base, inc, name, description]);
  const validation = useMemo(() => (pruned === null ? null : cuadra.templates.validate(pruned)), [cuadra, pruned]);
  const problem = validation !== null && !validation.ok ? validation.issues[0]?.message : undefined;
  const nothing = includeCount(inc) === 0;

  const download = async () => {
    if (pruned === null || validation === null || !validation.ok || nothing) return;
    setBusy(true);
    try {
      const file = cuadra.templates.serialize(validation.value);
      const res = await saveTextFile({ name: file.fileName, text: file.json, description: t('backup.tpl.title'), extension: '.json' });
      if (res === 'saved') toast({ message: 'backup.tpl.downloaded' });
    } catch (error) {
      toast({ message: 'common.error.toast', params: { message: errorMessage(error, t) }, tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };

  const set = (key: keyof TemplateInclude) => (v: boolean) => setInclude((s) => ({ ...s, [key]: v }));
  const counts = base === undefined ? { a: 0, f: 0, v: 0 } : { a: base.accounts.length, f: base.fields.length, v: base.views.length };

  return (
    <Card as="section" aria-labelledby={`${ids}-h`} className="bk-card">
      <div className="bk-cardhead">
        <h2 id={`${ids}-h`} className="bk-h2">
          {title}
        </h2>
        <InfoTip>{t('backup.tpl.exportTip')}</InfoTip>
      </div>

      {workspaceId === undefined && workspaces.isSuccess && list.length === 0 ? (
        <EmptyState message={t('backup.tpl.noSpaces')} rows={3} />
      ) : null}
      {workspaces.isPending ? (
        <p className="bk-note" role="status">
          {t('backup.tpl.loadingSpaces')}
        </p>
      ) : null}
      {workspaces.isError || exported.isError ? <LoadError onRetry={() => void (workspaces.isError ? workspaces.refetch() : exported.refetch())} /> : null}

      {wsId !== '' && base !== undefined ? (
        <form
          className="bk-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void download();
          }}
          noValidate
        >
          {workspaceId === undefined ? (
            <Field label={t('backup.tpl.space')}>
              <Select options={list.map((w) => ({ value: w.id, label: w.name }))} value={picked} onChange={setPicked} />
            </Field>
          ) : null}
          <Field label={t('backup.tpl.templateName')}>
            <Input value={name} maxLength={80} autoComplete="off" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('backup.tpl.description')} aside={t('backup.tpl.optional')}>
            <Textarea value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <fieldset className="bk-include">
            <legend className="bk-legend">{t('backup.tpl.include')}</legend>
            <Switch label={`${t('backup.tpl.accounts')} · ${counts.a}`} checked={include.accounts} onChange={set('accounts')} />
            <Switch label={`${t('backup.tpl.fields')} · ${counts.f}`} checked={include.fields} onChange={set('fields')} />
            <Switch
              label={`${t('backup.tpl.views')} · ${counts.v}`}
              checked={inc.views}
              disabled={!viewsAvailable(include)}
              description={viewsAvailable(include) ? undefined : t('backup.tpl.includeViewsOff')}
              onChange={set('views')}
            />
          </fieldset>
          {problem === undefined ? null : <Banner tone="warn">{t('backup.tpl.exportInvalid', { message: problem })}</Banner>}
          <div className="bk-actions">
            <Button
              type="submit"
              variant="secondary"
              icon={Download}
              loading={busy}
              disabled={nothing || problem !== undefined}
              {...(nothing ? { disabledReason: t('backup.tpl.nothing') } : {})}
            >
              {t('backup.tpl.download')}
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
