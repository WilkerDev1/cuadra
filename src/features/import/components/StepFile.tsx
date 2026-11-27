import { FileSpreadsheet, FolderOpen, Download } from 'lucide-react';
import { useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useCuadra } from '../../../app/data/CuadraProvider';
import { errorMessage } from '../../../app/data/errorMessage';
import { useUiStore } from '../../../app/state/uiStore';
import { useT } from '../../../i18n';
import { Banner, Button, cx, Field, InfoTip, Select } from '../../../ui';
import { csvBlob, downloadBlob, xlsxBlob } from '../files';
import { MAX_IMPORT_BYTES, readImportFile, type LoadedFile, type ReadFailure } from '../readFile';

export interface StepFileProps {
  workspaceId: string;
  loaded: LoadedFile | null;
  /** Archivo original (para cambiar de hoja sin volver a pedirlo). */
  file: File | null;
  onLoaded: (loaded: LoadedFile, file: File) => void;
}

/** Paso 1 · elegir o arrastrar el archivo, y bajar la plantilla. */
export function StepFile({ workspaceId, loaded, file, onLoaded }: StepFileProps) {
  const t = useT();
  const cuadra = useCuadra();
  const toast = useUiStore((s) => s.pushToast);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ReadFailure | null>(null);
  const dropId = useId();

  const load = async (f: File, sheet?: string) => {
    setBusy(true);
    setFailure(null);
    const result = await readImportFile(cuadra, f, sheet === undefined ? {} : { sheet });
    setBusy(false);
    if (result.ok) onLoaded(result.file, f);
    else setFailure(result.reason);
  };

  const onPick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f !== undefined) void load(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files[0];
    if (f !== undefined) void load(f);
  };

  const template = async (kind: 'csv' | 'xlsx') => {
    try {
      const name = t('import.template.fileName');
      if (kind === 'csv') downloadBlob(csvBlob(await cuadra.importCsv.templateCsv(workspaceId)), `${name}.csv`);
      else downloadBlob(await xlsxBlob(await cuadra.importCsv.templateTable(workspaceId), t('import.template.sheet')), `${name}.xlsx`);
    } catch (error) {
      toast({ message: 'common.error.toast', params: { message: errorMessage(error, t) }, tone: 'warn' });
    }
  };

  const failureText = (reason: ReadFailure): string => {
    switch (reason) {
      case 'unsupported':
        return t('import.file.unsupported');
      case 'xls':
        return t('import.file.xls');
      case 'empty':
        return t('import.file.empty');
      case 'tooBig':
        return t('import.file.tooBig', { max: `${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)} MB` });
      default:
        return t('import.file.failed');
    }
  };

  return (
    <div className="imp-stack">
      <input
        ref={input}
        type="file"
        className="visually-hidden"
        accept=".csv,.txt,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="import-file"
        onChange={onPick}
      />

      <div
        id={dropId}
        className={cx('imp-drop', loaded === null && 'ruled', over && 'imp-drop--over', loaded !== null && 'imp-drop--has')}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        {loaded === null ? (
          <>
            <p className="imp-drop__msg">{over ? t('import.file.dropActive') : t('import.file.drop')}</p>
            <div className="imp-drop__action">
              <Button variant="secondary" icon={FolderOpen} loading={busy} onClick={() => input.current?.click()}>
                {busy ? t('import.file.reading') : t('import.file.pick')}
              </Button>
            </div>
          </>
        ) : (
          <div className="imp-loaded">
            <FileSpreadsheet aria-hidden="true" className="imp-loaded__icon" />
            <div className="imp-loaded__text">
              <p className="imp-loaded__name" data-testid="loaded-name">
                {loaded.fileName}
              </p>
              <p className="imp-loaded__meta num">
                {t('import.file.detected', { rows: loaded.raw.rows.length, cols: loaded.raw.headers.length })}
                {loaded.kind === 'csv' && loaded.delimiter !== null && loaded.encoding !== null
                  ? ` · ${t('import.file.csvInfo', { delimiter: loaded.delimiter === '\t' ? t('import.file.delim.tab') : loaded.delimiter, encoding: t(`import.file.encoding.${loaded.encoding}`) })}`
                  : ''}
              </p>
            </div>
            <Button variant="ghost" icon={FolderOpen} loading={busy} onClick={() => input.current?.click()}>
              {t('import.file.pickAnother')}
            </Button>
          </div>
        )}
      </div>

      {failure === null ? null : <Banner tone="warn">{failureText(failure)}</Banner>}

      {loaded !== null && loaded.sheets.length > 1 && file !== null ? (
        <Field label={t('import.file.sheet')}>
          <Select
            options={loaded.sheets.map((s) => ({ value: s, label: s }))}
            value={loaded.sheet ?? ''}
            onChange={(sheet) => void load(file, sheet)}
          />
        </Field>
      ) : null}

      <div className="imp-templates">
        <span className="imp-templates__label">
          {t('import.file.template')}
          <InfoTip>{t('import.file.templateTip')}</InfoTip>
        </span>
        <Button variant="ghost" icon={Download} onClick={() => void template('csv')}>
          {t('import.file.templateCsv')}
        </Button>
        <Button variant="ghost" icon={Download} onClick={() => void template('xlsx')}>
          {t('import.file.templateXlsx')}
        </Button>
      </div>
      <p className="imp-note">{t('import.file.safety')}</p>
    </div>
  );
}
