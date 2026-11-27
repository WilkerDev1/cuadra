// ajustes/espacio: nombre, titular, tinta, moneda (con sus reglas) y archivar (DESIGN §10.15).
import { useId, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Money, type Currency, type Workspace } from '../../../core';
import { useTotals, useWorkspace } from '../../../app/data/hooks';
import { getLocale } from '../../../i18n/format';
import { useT } from '../../../i18n';
import { Banner, Button, Dialog, Field, InfoTip, Input, Segmented, Select } from '../../../ui';
import { Frame } from '../components/Frame';
import { Group } from '../components/Group';
import { Load } from '../components/Load';
import { TintPicker } from '../components/TintPicker';
import {
  buildCurrency,
  CURRENCY_PRESETS,
  currencyToDraft,
  decimalsLocked,
  MINOR_DIGITS,
  sameCurrency,
  sampleMinor,
  type CurrencyDraft,
} from '../lib/currency';
import { tintNumber } from '../lib/tint';
import { useRun } from '../lib/useRun';

export function Component() {
  const t = useT('settings');
  return (
    <Frame title={t('sec.space')}>
      <WorkspacePanel />
    </Frame>
  );
}

/** El contenido de «Espacio»; también se pinta en la página índice cuando hay sitio. */
export function WorkspacePanel() {
  const query = useWorkspace();
  return <Load query={query}>{(ws) => <WorkspaceForm key={`${ws.id}:${ws.updatedAt}`} workspace={ws} />}</Load>;
}

function formatSample(currency: Currency): string {
  return Money.format(sampleMinor(currency.minorDigits), { locale: getLocale(), currency });
}

function WorkspaceForm({ workspace }: { workspace: Workspace }) {
  const t = useT('settings');
  const navigate = useNavigate();
  const { run, error, clearError, busy } = useRun();
  const totals = useTotals({ status: 'all' });
  const locked = decimalsLocked((totals.data?.count ?? 0) + (totals.data?.voidedCount ?? 0));

  const [name, setName] = useState(workspace.name);
  const [owner, setOwner] = useState(workspace.ownerName);
  const [color, setColor] = useState<string | null>(tintNumber(workspace.color) === null ? null : workspace.color);
  const [draft, setDraft] = useState<CurrencyDraft>(currencyToDraft(workspace.currency));
  const [submitted, setSubmitted] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const digitsId = useId();

  const built = buildCurrency(draft);
  const nameMissing = name.trim() === '';
  const dirty =
    name.trim() !== workspace.name ||
    owner.trim() !== workspace.ownerName ||
    color !== (tintNumber(workspace.color) === null ? null : workspace.color) ||
    !built.ok ||
    !sameCurrency(built.value, workspace.currency);
  const preset = CURRENCY_PRESETS.some((p) => p.code === draft.code.trim().toUpperCase()) ? draft.code.trim().toUpperCase() : '';

  const discard = () => {
    setName(workspace.name);
    setOwner(workspace.ownerName);
    setColor(tintNumber(workspace.color) === null ? null : workspace.color);
    setDraft(currencyToDraft(workspace.currency));
    setSubmitted(false);
    clearError();
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (nameMissing || !built.ok) return;
    const currencyChanged = !sameCurrency(built.value, workspace.currency);
    await run(
      (c) =>
        c.workspaces.update(workspace.id, {
          name: name.trim(),
          ownerName: owner.trim(),
          color,
          ...(currencyChanged ? { currency: built.value } : {}),
        }),
      () =>
        currencyChanged
          ? { key: 'settings.space.savedCurrency', params: { sample: formatSample(built.value) } }
          : { key: 'settings.space.saved' },
    );
  };

  const archive = async () => {
    setConfirmArchive(false);
    const r = await run((c) => c.workspaces.archive(workspace.id), () => ({ key: 'settings.space.archived', params: { name: workspace.name } }));
    if (r.ok) void navigate('/');
  };
  const unarchive = () =>
    run((c) => c.workspaces.unarchive(workspace.id), () => ({ key: 'settings.space.unarchived', params: { name: workspace.name } }));

  const archived = workspace.archivedAt !== null;

  return (
    <div className="set-stack">
      {error === null ? null : <Banner tone="warn">{error}</Banner>}
      {archived ? (
        <Banner
          action={
            <Button variant="secondary" onClick={() => void unarchive()} loading={busy}>
              {t('space.unarchive')}
            </Button>
          }
        >
          {t('space.isArchived')}
        </Banner>
      ) : null}
      <form className="set-form" onSubmit={(e) => void save(e)} noValidate>
        <Field label={t('space.name')} error={submitted && nameMissing ? t('new.nameRequired') : undefined}>
          <Input value={name} onChange={(e) => setName(e.currentTarget.value)} autoComplete="off" required />
        </Field>
        <Field label={t('space.owner')} help={t('space.ownerHelp')}>
          <Input value={owner} onChange={(e) => setOwner(e.currentTarget.value)} autoComplete="off" />
        </Field>
        <Group label={t('space.color')}>
          <TintPicker label={t('space.color')} value={color} onChange={setColor} allowNone />
        </Group>

        <fieldset className="set-fieldset">
          <legend className="set-legend">{t('space.currency')}</legend>
          <Field label={t('space.preset')}>
            <Select
              value={preset}
              placeholder={t('space.codeOther')}
              options={CURRENCY_PRESETS.map((p) => ({ value: p.code, label: `${p.code} · ${p.symbol}` }))}
              onChange={(code) => {
                const p = CURRENCY_PRESETS.find((x) => x.code === code);
                if (p !== undefined) setDraft((d) => ({ code: p.code, symbol: p.symbol, minorDigits: locked ? d.minorDigits : p.minorDigits }));
              }}
            />
          </Field>
          <div className="set-pair">
            <Field label={t('space.code')} error={submitted && !built.ok && built.issue === 'code' ? t('space.codeInvalid') : undefined}>
              <Input
                value={draft.code}
                onChange={(e) => {
                  const code = e.currentTarget.value;
                  setDraft((d) => ({ ...d, code }));
                }}
                maxLength={3}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label={t('space.symbol')} error={submitted && !built.ok && built.issue === 'symbol' ? t('space.symbolInvalid') : undefined}>
              <Input
                value={draft.symbol}
                onChange={(e) => {
                  const symbol = e.currentTarget.value;
                  setDraft((d) => ({ ...d, symbol }));
                }}
                maxLength={6}
                autoComplete="off"
              />
            </Field>
          </div>
          <Group label={t('space.digits')} aside={locked ? <InfoTip label={t('space.digits')}>{t('space.digitsLocked')}</InfoTip> : undefined}>
            <Segmented
              className="set-seg"
              label={t('space.digits')}
              value={String(draft.minorDigits) as '0' | '2' | '3'}
              onChange={(v) => setDraft((d) => ({ ...d, minorDigits: Number(v) as 0 | 2 | 3 }))}
              options={MINOR_DIGITS.map((n) => ({ value: String(n) as '0' | '2' | '3', label: String(n), disabled: locked && n !== draft.minorDigits }))}
            />
          </Group>
          {built.ok ? (
            <p id={digitsId} className="set-sample num" aria-live="polite">
              {t('space.preview', { sample: formatSample(built.value) })}
            </p>
          ) : null}
        </fieldset>

        {dirty ? (
          <div className="set-savebar">
            <Button type="submit" variant="primary" loading={busy}>
              {t('save')}
            </Button>
            <Button variant="ghost" onClick={discard}>
              {t('cancel')}
            </Button>
          </div>
        ) : null}
      </form>

      {archived ? null : (
        <div className="set-danger">
          <Button variant="danger" onClick={() => setConfirmArchive(true)}>
            {t('space.archive')}
          </Button>
        </div>
      )}
      <Dialog
        open={confirmArchive}
        onClose={() => setConfirmArchive(false)}
        variant="destructive"
        title={t('space.archiveTitle', { name: workspace.name })}
        description={t('space.archiveBody')}
        confirmLabel={t('space.archive')}
        onConfirm={() => void archive()}
      />
    </div>
  );
}
