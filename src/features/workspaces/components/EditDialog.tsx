import { Check } from 'lucide-react';
import { useEffect, useId, useState, type CSSProperties } from 'react';
import type { WorkspaceSummary } from '../../../core';
import { useCuadraMutation } from '../../../app/data/useCuadraMutation';
import { errorMessage } from '../../../app/data/errorMessage';
import { useT } from '../../../i18n';
import { Dialog, Field, Input } from '../../../ui';
import { checkEdit, hasEditChanges, TINTS, type TintKey } from '../logic';
import { effectiveTintKey } from '../tint';

/** Renombrar y cambiar el color (la tinta del lomo) de un espacio. */
export function EditDialog({ ws, open, onClose }: { ws: WorkspaceSummary | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const groupId = useId();
  const [name, setName] = useState('');
  const [color, setColor] = useState<TintKey>('tint-1');
  const [error, setError] = useState<string | null>(null);
  const save = useCuadraMutation(
    (c, input: { id: string; name: string; color: TintKey }) => c.workspaces.update(input.id, { name: input.name, color: input.color }),
    { successToast: (w) => ({ key: 'workspaces.toast.saved', params: { name: w.name } }), errorToast: false },
  );

  const initial = ws === null ? null : { name: ws.name, color: effectiveTintKey(ws.color, ws.id) as TintKey };
  const wsId = ws?.id;
  useEffect(() => {
    if (open && initial !== null) {
      setName(initial.name);
      setColor(initial.color);
      setError(null);
      save.reset();
    }
    // Se reinicia solo al abrir sobre otro espacio.
  }, [open, wsId]);

  const confirm = async () => {
    if (ws === null || initial === null) return;
    const check = checkEdit({ name, color });
    if (!check.ok) {
      setError(t('workspaces.edit.nameEmpty'));
      return;
    }
    if (!hasEditChanges(initial, { name, color })) {
      onClose();
      return;
    }
    try {
      await save.mutateAsync({ id: ws.id, name: check.name, color });
      onClose();
    } catch (e) {
      setError(errorMessage(e, t));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('workspaces.edit.title')}
      confirmLabel={t('workspaces.edit.save')}
      onConfirm={() => void confirm()}
      confirmLoading={save.isPending}
    >
      <form
        className="wsp-edit"
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <Field label={t('workspaces.edit.name')} error={error ?? undefined}>
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            autoComplete="off"
            maxLength={80}
            enterKeyHint="done"
          />
        </Field>
        <fieldset className="wsp-tints">
          <legend className="wsp-tints__legend">{t('workspaces.edit.color')}</legend>
          <div className="wsp-tints__row" role="radiogroup" aria-label={t('workspaces.edit.color')}>
            {TINTS.map((tint, i) => (
              <label key={tint} className="wsp-tint" style={{ '--swatch': `var(--${tint})` } as CSSProperties}>
                <input
                  type="radio"
                  name={groupId}
                  value={tint}
                  checked={color === tint}
                  onChange={() => setColor(tint)}
                  className="visually-hidden"
                />
                <span className="wsp-tint__chip">
                  <Check aria-hidden="true" />
                </span>
                <span className="visually-hidden">{t(`workspaces.tint.${i + 1}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {/* Enter dentro del campo guarda: el botón real del diálogo está fuera del formulario. */}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
