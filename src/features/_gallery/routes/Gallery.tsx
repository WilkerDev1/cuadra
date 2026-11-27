import { useState, type ReactNode } from 'react';
import { Ban, Copy, Eye, History, Pencil, Search } from 'lucide-react';
import type { DateRange, FieldValue, TxKind } from '../../../core/types';
import { useT } from '../../../i18n';
import { useUiStore, type ThemeChoice } from '../../../app/state/uiStore';
import {
  AccountChip,
  AmountKeypad,
  AmountText,
  Banner,
  Bars,
  Button,
  Card,
  Chip,
  Combobox,
  DateField,
  Dialog,
  DoubleRule,
  EmptyState,
  Field,
  FieldInput,
  FilterChips,
  IconButton,
  InfoTip,
  Input,
  KIND_TONE,
  KindBadge,
  Ladder,
  LedgerDay,
  LedgerList,
  Line,
  ListRow,
  Menu,
  PeriodPicker,
  Segmented,
  Select,
  Sheet,
  Skeleton,
  Sparkline,
  Stamp,
  Switch,
  Table,
  Textarea,
  ToastProvider,
  Total,
  amountParts,
  useToast,
} from '../../../ui';
import { BARS, FIELDS, FLOWS, LINE, ROWS, SPARK, TODAY } from './sample';
import '../gallery.css';

const DOP = { code: 'DOP', minorDigits: 2, symbol: 'RD$' } as const;
const money = (m: number, kind?: 'income' | 'expense') => amountParts(m, { locale: 'es-DO', currency: DOP, kind }).text;

function Section({ id, title, children, wide }: { id: string; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={wide === true ? 'gal-section gal-section--wide' : 'gal-section'} aria-labelledby={id}>
      <h2 id={id} className="gal-h2">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Demo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="gal-demo">
      <p className="gal-demo__label">{label}</p>
      <div className="gal-demo__body">{children}</div>
    </div>
  );
}

const SWATCHES = ['bg', 'surface', 'surface-2', 'sunken', 'rule', 'rule-strong', 'control', 'ink', 'ink-2', 'ink-3', 'forest', 'lime', 'accent-ink', 'in', 'out', 'xfer', 'warn-ink', 'in-wash', 'out-wash', 'xfer-wash', 'warn-wash'];

function Tokens() {
  return (
    <div className="gal-swatches">
      {SWATCHES.map((s) => (
        <div key={s} className="gal-swatch">
          <span className="gal-swatch__chip" style={{ background: `var(--${s})` }} />
          <code>--{s}</code>
        </div>
      ))}
      <div className="gal-tints" aria-label="Tintas de lomo">
        {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
          <span key={n} style={{ background: `var(--tint-${n})` }} />
        ))}
      </div>
    </div>
  );
}

function Typography() {
  return (
    <div className="gal-type">
      <p className="gal-display">
        Cuadra<span className="gal-display__dot" aria-hidden="true" />
      </p>
      <h1>Movimientos</h1>
      <h2>Por categoría</h2>
      <h3>Caja chica</h3>
      <p>Tu libro de caja, al día y sin enredos. Cuerpo a 1rem con peso 420 y cifras tabulares: 1,850.00 · 12,400.00.</p>
      <p className="meta">Materiales · Caja · n.º 0142</p>
      <p className="gal-tape num">+ 1,500.00{'\n'}− 350.00</p>
    </div>
  );
}

function Overlays() {
  const t = useT('ui.gallery');
  const [sheet, setSheet] = useState<null | 'plain' | 'dirty'>(null);
  const [dialog, setDialog] = useState(false);
  return (
    <div className="gal-row">
      <Button onClick={() => setSheet('plain')}>{t('sheet.open')}</Button>
      <Button onClick={() => setSheet('dirty')}>{t('sheet.dirty')}</Button>
      <Button variant="danger" icon={Ban} onClick={() => setDialog(true)}>
        {t('dialog.open')}
      </Button>
      <Menu
        label="Más acciones de Compra de cemento"
        items={[
          { id: 'v', label: 'Ver', icon: Eye, onSelect: () => {} },
          { id: 'e', label: 'Editar', icon: Pencil, onSelect: () => {} },
          { id: 'd', label: 'Duplicar', icon: Copy, onSelect: () => {} },
          { id: 'a', label: 'Anular', icon: Ban, tone: 'danger', onSelect: () => setDialog(true) },
        ]}
      />
      <span className="gal-inline">
        Transferencias <InfoTip>Las transferencias y los saldos iniciales no cuentan como entrada ni salida.</InfoTip>
      </span>
      <span className="gal-inline">
        Monto inusual{' '}
        <InfoTip tone="warn" label="Aviso">
          Es mucho más que lo usual en Materiales. ¿Está bien?
        </InfoTip>
      </span>
      <Sheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        title={t('sheet.title')}
        dirty={sheet === 'dirty'}
        height="tall"
        footer={
          <>
            <Button variant="danger" icon={Ban}>
              {t('btn.void')}
            </Button>
            <Button variant="secondary" icon={Pencil}>
              {t('btn.edit')}
            </Button>
          </>
        }
      >
        <div className="gal-sheet">
          <p className="small ink-2">{t('sheet.body')}</p>
          <AmountText minor={185000} kind="expense" size="l" />
          <p className="ink-2">Martes 24 nov 2026 · anotado el 25 nov</p>
          <dl className="gal-dl ruled">
            <dt>Concepto</dt>
            <dd>Compra de cemento</dd>
            <dt>Categoría</dt>
            <dd>Materiales</dd>
            <dt>Contacto</dt>
            <dd>Distribuidora Norte (ejemplo)</dd>
          </dl>
          {sheet === 'dirty' ? (
            <Field label={t('field.notes')}>
              <Textarea defaultValue="Cambio sin guardar" />
            </Field>
          ) : null}
        </div>
      </Sheet>
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        variant="destructive"
        title={t('dialog.title')}
        description={t('dialog.body')}
        confirmLabel={t('btn.void')}
        onConfirm={() => setDialog(false)}
      >
        <Field label={t('dialog.reason')}>
          <Input placeholder={t('dialog.reasonPh')} />
        </Field>
      </Dialog>
    </div>
  );
}

function Toasts() {
  const t = useT('ui.gallery');
  const toast = useToast();
  return (
    <div className="gal-row">
      <Button
        onClick={() =>
          toast.show({
            tone: 'undo',
            message: t('toast.undoMsg', { amount: money(35000, 'expense') }),
            action: { onAction: () => toast.show({ message: t('toast.undone'), duration: 2500 }) },
          })
        }
      >
        {t('toast.undo')}
      </Button>
      <Button variant="ghost" onClick={() => toast.show({ message: t('toast.infoMsg') })}>
        {t('toast.info')}
      </Button>
      <Button variant="ghost" onClick={() => toast.show({ tone: 'warn', message: t('toast.warnMsg') })}>
        {t('toast.warn')}
      </Button>
    </div>
  );
}

function Fields() {
  const t = useT('ui.gallery');
  const [cat, setCat] = useState('o1');
  const [combo, setCombo] = useState<string | null>('o2');
  const [date, setDate] = useState(TODAY);
  const [created, setCreated] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, FieldValue | undefined>>({ 'f-cat': { type: 'list', optionId: 'o4' } });
  const options = FIELDS[0]?.options.map((o) => ({ value: o.id, label: o.label, inactive: !o.active })) ?? [];
  return (
    <div className="gal-grid">
      <Field label={t('field.concept')} help={t('field.conceptHelp')}>
        <Input placeholder={t('field.conceptPh')} />
      </Field>
      <Field label={t('field.amount')} error={t('field.amountError')}>
        <Input prefix="RD$" inputMode="decimal" defaultValue="0" className="num" />
      </Field>
      <Field label={t('field.amount')} aside={<InfoTip>Acepta aritmética: 1500+350.</InfoTip>}>
        <Input prefix="RD$" defaultValue="1500+350" suffix={<AmountText minor={185000} size="row" neutral symbol={false} />} className="num" />
      </Field>
      <Field label={t('field.notes')} aside={t('field.optional')}>
        <Textarea placeholder="Notas" />
      </Field>
      <Field label={t('field.category')}>
        <Select options={options} value={cat} onChange={setCat} onCreate={() => setCreated('…')} />
      </Field>
      <Field label={`${t('field.contact')} (combobox)`} {...(created === null ? {} : { help: t('field.created', { name: created }) })}>
        <Combobox options={options} value={combo} onChange={setCombo} onCreate={(name) => setCreated(name)} placeholder="Escribe para buscar" />
      </Field>
      <Field label={t('field.date')}>
        <DateField value={date} onChange={setDate} today={TODAY} />
      </Field>
      <Field label="Deshabilitado">
        <Input disabled defaultValue="Caja" />
      </Field>
      <div className="gal-stack">
        <p className="gal-demo__label">FieldInput · campos personalizables</p>
        {FIELDS.map((f) => (
          <FieldInput
            key={f.id}
            field={f}
            today={TODAY}
            value={values[f.id]}
            onChange={(v) => setValues((s) => ({ ...s, [f.id]: v }))}
            onCreateOption={() => setCreated('…')}
          />
        ))}
      </div>
    </div>
  );
}

function ChoiceDemo() {
  const t = useT('ui.gallery');
  const [kind, setKind] = useState<TxKind>('expense');
  const [density, setDensity] = useState('comfy');
  const [cats, setCats] = useState<string[]>(['Materiales']);
  const [voided, setVoided] = useState(false);
  return (
    <div className="gal-stack">
      <Segmented
        label={t('seg.label')}
        fullWidth
        value={kind}
        onChange={setKind}
        options={[
          { value: 'income', label: 'Entrada', tone: KIND_TONE.income },
          { value: 'expense', label: 'Salida', tone: KIND_TONE.expense },
          { value: 'transfer', label: 'Transferencia', tone: KIND_TONE.transfer },
        ]}
      />
      <Segmented
        label={t('seg.density')}
        value={density}
        onChange={setDensity}
        options={[
          { value: 'comfy', label: t('seg.comfy') },
          { value: 'compact', label: t('seg.compact') },
        ]}
      />
      <div className="gal-chips">
        {['Materiales', 'Servicios', 'Nómina', 'Transporte', 'Varios'].map((c) => (
          <Chip key={c} selected={cats.includes(c)} onClick={() => setCats((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]))}>
            {c}
          </Chip>
        ))}
        <Chip variant="info">3 cuentas · 14 categorías</Chip>
        <Chip variant="info" tint="var(--tint-3)">
          Centro de costo
        </Chip>
        <Chip disabled>Inactiva</Chip>
      </div>
      <Switch label={t('switch.voided')} description={t('switch.voidedDesc')} checked={voided} onChange={setVoided} />
      <Switch label={t('switch.active')} defaultChecked />
      <Switch label="Deshabilitado" disabled />
    </div>
  );
}

function Ledger() {
  const t = useT('ui.gallery');
  const days = [...new Set(ROWS.map((r) => r.date))];
  return (
    <LedgerList label={t('ledger.label')}>
      {days.map((d) => {
        const rows = ROWS.filter((r) => r.date === d);
        const net = rows.reduce((s, r) => s + (r.voided === true || r.kind === 'transfer' ? 0 : r.kind === 'income' ? r.minor : -r.minor), 0);
        return (
          <LedgerDay
            key={d}
            label={d === '2026-11-24' ? 'Martes 24 nov' : 'Lunes 23 nov'}
            total={
              <>
                {t('ledger.net')} <AmountText minor={Math.abs(net)} kind={net >= 0 ? 'income' : 'expense'} size="row" />
              </>
            }
          >
            {rows.map((r) => (
              <div role="listitem" key={r.id}>
                <ListRow
                  title={r.title}
                  meta={`${r.category} · ${r.account} · n.º ${String(r.seq).padStart(4, '0')}`}
                  trailing={<AmountText minor={r.minor} kind={r.kind} voided={r.voided === true} size="row" />}
                  trailingMeta={money(r.running)}
                  voided={r.voided === true}
                  onOpen={() => {}}
                  actions={[
                    { id: 'dup', label: 'Duplicar', icon: Copy, onSelect: () => {} },
                    { id: 'void', label: 'Anular', icon: Ban, tone: 'danger', onSelect: () => {} },
                  ]}
                />
              </div>
            ))}
          </LedgerDay>
        );
      })}
    </LedgerList>
  );
}

function LedgerTable() {
  const t = useT('ui.gallery');
  const [selected, setSelected] = useState<string | null>('t2');
  const inTotal = ROWS.filter((r) => r.kind === 'income' && r.voided !== true).reduce((s, r) => s + r.minor, 0);
  const outTotal = ROWS.filter((r) => r.kind === 'expense' && r.voided !== true).reduce((s, r) => s + r.minor, 0);
  return (
    <Table
      caption={t('table.caption')}
      rows={ROWS}
      rowKey={(r) => r.id}
      selectedKey={selected}
      onRowClick={(r) => setSelected(r.id)}
      isVoided={(r) => r.voided === true}
      footer
      columns={[
        { key: 'date', header: t('table.date'), render: (r) => r.date.slice(8) + ' nov', width: '5rem', footer: t('table.total') },
        { key: 'no', header: t('table.no'), numeric: true, render: (r) => String(r.seq).padStart(4, '0'), hideStacked: true },
        { key: 'concept', header: t('table.concept'), grow: true, render: (r) => r.title },
        { key: 'cat', header: t('table.category'), render: (r) => r.category },
        {
          key: 'in', header: t('table.in'), align: 'end',
          render: (r) => (r.kind === 'income' ? <AmountText minor={r.minor} kind="income" notation="columns" size="table" symbol={false} voided={r.voided === true} /> : null),
          footer: <AmountText minor={inTotal} size="table" symbol={false} rule="double" neutral />,
        },
        {
          key: 'out', header: t('table.out'), align: 'end',
          render: (r) => (r.kind === 'expense' ? <AmountText minor={r.minor} kind="expense" notation="columns" size="table" symbol={false} voided={r.voided === true} /> : null),
          footer: <AmountText minor={outTotal} size="table" symbol={false} rule="double" neutral />,
        },
        { key: 'bal', header: t('table.balance'), align: 'end', render: (r) => <AmountText minor={r.id === 't3' ? -120000 : r.running} notation="parens" size="table" symbol={false} /> },
      ]}
    />
  );
}

function Amounts() {
  const t = useT('ui.gallery');
  const [n, setN] = useState(1240000);
  return (
    <div className="gal-stack">
      <Card variant="forest" className="gal-balance">
        <p className="gal-balance__label">{t('card.balance')}</p>
        <div className="gal-balance__fig">
          <AmountText minor={n} size="hero" highlight onForest animate />
        </div>
        <p className="gal-balance__meta">{t('card.balanceMeta')}</p>
      </Card>
      <div className="gal-row">
        <Button variant="ghost" onClick={() => setN((v) => v + 185000)}>
          + RD$1,850 (conteo)
        </Button>
      </div>
      <Demo label={t('amount.long')}>
        <div className="gal-narrow">
          <AmountText minor={123456789} size="hero" />
        </div>
      </Demo>
      <Demo label={t('amount.l')}>
        <AmountText minor={-435000} size="l" rule="double" />
      </Demo>
      <Demo label={t('amount.rows')}>
        <div className="gal-amounts">
          <AmountText minor={185000} kind="income" />
          <AmountText minor={185000} kind="expense" />
          <AmountText minor={185000} kind="transfer" />
          <AmountText minor={1500000} kind="opening" />
          <AmountText minor={-120000} />
          <AmountText minor={1240000} />
          <AmountText minor={185000} kind="expense" voided />
        </div>
      </Demo>
      <Demo label={t('amount.table')}>
        <div className="gal-amounts">
          <AmountText minor={-120000} notation="parens" size="table" symbol={false} />
          <AmountText minor={185000} notation="columns" kind="expense" size="table" symbol={false} />
        </div>
      </Demo>
    </div>
  );
}

function Keypad() {
  const t = useT('ui.gallery');
  const [kind, setKind] = useState<TxKind>('expense');
  const [log, setLog] = useState('');
  const tint = kind === 'income' ? 'var(--in-wash)' : kind === 'expense' ? 'var(--out-wash)' : 'var(--xfer-wash)';
  return (
    <div className="gal-phone" style={{ background: tint }}>
      <Segmented
        label={t('seg.label')}
        fullWidth
        value={kind}
        onChange={setKind}
        options={[
          { value: 'income', label: 'Entrada', tone: KIND_TONE.income },
          { value: 'expense', label: 'Salida', tone: KIND_TONE.expense },
          { value: 'transfer', label: 'Transferencia', tone: KIND_TONE.transfer },
        ]}
      />
      <AmountKeypad
        kind={kind}
        onSubmit={(m) => setLog(t('keypad.saved', { amount: money(m) }))}
        onAnother={(m) => setLog(t('keypad.another', { amount: money(m) }))}
      >
        <div className="gal-context">
          <AccountChip name="Caja" accountType="cash" />
          <Chip>Hoy</Chip>
          <Chip selected>Materiales</Chip>
          <Chip>Servicios</Chip>
          <Chip>Nómina</Chip>
        </div>
      </AmountKeypad>
      <p className="meta" role="status">
        {log === '' ? t('keypad.lede') : log}
      </p>
    </div>
  );
}

function Marks() {
  const t = useT('ui.gallery');
  const [k, setK] = useState(0);
  return (
    <div className="gal-stack">
      <div className="gal-row gal-row--center">
        <Stamp key={k} animate size="3.5rem" />
        <div>
          <p className="gal-squared">Cuadra.</p>
          <p className="meta">{t('marks.squared')}</p>
        </div>
        <Button variant="ghost" onClick={() => setK((v) => v + 1)}>
          {t('marks.redraw')}
        </Button>
      </div>
      <div className="gal-void">
        <Stamp variant="anulado" />
        <AmountText minor={185000} kind="expense" size="l" voided />
      </div>
      <Total label={t('marks.subtotal')} minor={1240000} variant="single" />
      <Total label={t('marks.total')} minor={4365000} animate />
      <DoubleRule animate animateKey={k} />
    </div>
  );
}

function Domain() {
  const t = useT('ui.gallery');
  const [period, setPeriod] = useState<DateRange>({ preset: 'this_month' });
  const [filters, setFilters] = useState(['cat', 'acct']);
  return (
    <div className="gal-stack">
      <div className="gal-row">
        <KindBadge kind="income" />
        <KindBadge kind="expense" />
        <KindBadge kind="transfer" />
        <KindBadge kind="opening" />
        <KindBadge kind="expense" size="lg" />
      </div>
      <div className="gal-strip" aria-label={t('domain.accounts')}>
        <AccountChip variant="card" name="Caja" accountType="cash" balanceMinor={1240000} extra={<Sparkline values={SPARK} label={t('charts.spark')} />} />
        <AccountChip variant="card" name="Banco Popular" accountType="bank" balanceMinor={31000000} />
        <AccountChip variant="card" name="Tarjeta de crédito" accountType="card" balanceMinor={-435000} />
        <AccountChip variant="card" name="Ahorro" accountType="savings" balanceMinor={0} archived />
      </div>
      <div className="gal-row">
        <AccountChip variant="card" caption={t('domain.from')} name="Caja" accountType="cash" balanceMinor={1240000} />
        <IconButton label="Invertir cuentas" icon={History} variant="secondary" />
        <AccountChip variant="card" caption={t('domain.to')} name="Banco" accountType="bank" balanceMinor={310000} />
      </div>
      <div className="gal-row">
        <PeriodPicker value={period} onChange={setPeriod} today={TODAY} />
      </div>
      <FilterChips
        onAdd={() => setFilters(['cat', 'acct', 'center'])}
        onClear={() => setFilters([])}
        filters={[
          { id: 'period', label: 'Periodo', value: 'Este mes', onOpen: () => {} },
          ...filters.map((f) => ({
            id: f,
            label: f === 'cat' ? 'Categoría' : f === 'acct' ? 'Cuenta' : 'Centro',
            value: f === 'cat' ? 'Materiales +2' : f === 'acct' ? 'Caja' : 'Diseño',
            onOpen: () => {},
            onRemove: () => setFilters((s) => s.filter((x) => x !== f)),
          })),
        ]}
      />
    </div>
  );
}

function GalleryBody() {
  const t = useT('ui.gallery');
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);
  return (
    <div className="gal">
      <header className="gal-head">
        <div>
          <h1>{t('title')}</h1>
          <p className="gal-lede">{t('lede')}</p>
        </div>
        <Segmented<ThemeChoice>
          label={t('theme')}
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: t('theme.system') },
            { value: 'light', label: t('theme.light') },
            { value: 'dark', label: t('theme.dark') },
          ]}
        />
      </header>
      <Banner tone="info">{t('banner.info')}</Banner>
      <div className="gal-sections">
        <Section id="g-tokens" title={t('s.tokens')}>
          <Tokens />
        </Section>
        <Section id="g-type" title={t('s.type')}>
          <Typography />
        </Section>
        <Section id="g-buttons" title={t('s.buttons')}>
          <div className="gal-stack">
            <div className="gal-row">
              <Button variant="primary">{t('btn.save')}</Button>
              <Button>{t('btn.cancel')}</Button>
              <Button variant="ghost" icon={Pencil}>
                {t('btn.edit')}
              </Button>
              <Button variant="danger" icon={Ban}>
                {t('btn.void')}
              </Button>
            </div>
            <div className="gal-row">
              <Button loading>{t('btn.loading')}</Button>
              <Button disabled disabledReason={t('btn.disabledReason')}>
                {t('btn.disabled')}
              </Button>
            </div>
            <div className="gal-row">
              <IconButton label={t('ib.search')} icon={Search} />
              <IconButton label={t('ib.history')} icon={History} variant="secondary" />
              <IconButton label={t('ib.copy')} icon={Copy} disabled />
            </div>
            <div className="gal-forest">
              <Button variant="on-forest">{t('btn.forest')}</Button>
              <IconButton label={t('ib.search')} icon={Search} variant="on-forest" />
            </div>
          </div>
        </Section>
        <Section id="g-cards" title={t('s.cards')}>
          <div className="gal-stack">
            <Card>
              <p className="gal-demo__label">{t('card.plain')}</p>
              <div className="gal-month">
                <div>
                  <KindBadge kind="income" />
                  <AmountText minor={8420000} kind="income" size="m" />
                  <p className="meta">12 % más que octubre</p>
                </div>
                <div>
                  <KindBadge kind="expense" />
                  <AmountText minor={6135000} kind="expense" size="m" />
                  <p className="meta">3 % menos que octubre</p>
                </div>
              </div>
            </Card>
            <Card variant="sunken">
              <p className="small ink-2">{t('card.sunken')}</p>
            </Card>
            <Banner tone="warn" title={t('banner.warnTitle')} action={<Button>{t('banner.warnAction')}</Button>}>
              {t('banner.warnBody')}
            </Banner>
          </div>
        </Section>
        <Section id="g-fields" title={t('s.fields')} wide>
          <Fields />
        </Section>
        <Section id="g-choice" title={t('s.choice')}>
          <ChoiceDemo />
        </Section>
        <Section id="g-overlays" title={t('s.overlays')}>
          <Overlays />
        </Section>
        <Section id="g-toast" title={t('s.toast')}>
          <Toasts />
        </Section>
        <Section id="g-empty" title={t('s.empty')}>
          <div className="gal-stack">
            <EmptyState message={t('empty.first')} action={<Button>{t('empty.firstAction')}</Button>} rows={4} />
            <EmptyState variant="no-results" message={t('empty.none')} action={<Button variant="ghost">{t('empty.noneAction')}</Button>} rows={3} />
            <Skeleton delay={0} rows={3} />
          </div>
        </Section>
        <Section id="g-ledger" title={t('s.ledger')}>
          <Ledger />
        </Section>
        <Section id="g-table" title={t('s.table')} wide>
          <LedgerTable />
        </Section>
        <Section id="g-amounts" title={t('s.amounts')}>
          <Amounts />
        </Section>
        <Section id="g-keypad" title={t('s.keypad')}>
          <Keypad />
        </Section>
        <Section id="g-marks" title={t('s.marks')}>
          <Marks />
        </Section>
        <Section id="g-domain" title={t('s.domain')}>
          <Domain />
        </Section>
        <Section id="g-charts" title={t('s.charts')} wide>
          <div className="gal-charts">
            <Card>
              <Ladder title={t('charts.ladder')} days={FLOWS} openingMinor={2500000} />
            </Card>
            <Card>
              <Bars title={t('charts.bars')} data={BARS} />
            </Card>
            <Card>
              <Line title={t('charts.line')} points={LINE} step />
            </Card>
          </div>
        </Section>
      </div>
    </div>
  );
}

export function Component() {
  return (
    <ToastProvider>
      <GalleryBody />
    </ToastProvider>
  );
}
