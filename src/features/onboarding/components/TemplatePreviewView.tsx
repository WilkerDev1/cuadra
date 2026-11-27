import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { FIELD_TYPE_ICON, ACCOUNT_ICON, Chip } from '../../../ui';
import type { TemplatePreview } from '../../../core';
import { useT } from '../../../i18n';
import { categoryOptions, splitChips } from '../logic';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="onb-prev__group">
      <h3 className="onb-prev__h">{title}</h3>
      {children}
    </section>
  );
}

function Chips({ children }: { children: ReactNode }) {
  return <div className="onb-prev__chips">{children}</div>;
}

/**
 * Lo que va a crear una plantilla, con sus cuentas, campos, opciones y vistas reales (`templates.preview`).
 * `compact` es el panel del lomo (cuentas, categorías y campos); `full` lo muestra todo.
 */
export function TemplatePreviewView({
  preview,
  mode,
  seeAllTo,
}: {
  preview: TemplatePreview;
  mode: 'compact' | 'full';
  /** Solo en `compact`: enlace a la vista previa completa. */
  seeAllTo?: string;
}) {
  const t = useT();
  const categories = categoryOptions(preview);
  const full = mode === 'full';
  const catChips = splitChips(categories, full ? 30 : 6);
  const otherFields = preview.fields.filter((f) => f.role !== 'category');

  return (
    <div className={`onb-prev onb-prev--${mode}`}>
      <Group title={t('onboarding.preview.accounts')}>
        <Chips>
          {preview.accounts.map((a) => (
            <Chip key={a.key} variant="info" icon={ACCOUNT_ICON[a.type]}>
              {a.name}
            </Chip>
          ))}
        </Chips>
      </Group>

      {full ? (
        <Group title={t('onboarding.preview.fields')}>
          {preview.fields.length === 0 ? (
            <p className="onb-prev__empty">{t('onboarding.preview.noFields')}</p>
          ) : (
            <ul className="onb-prev__fields" role="list">
              {preview.fields.map((f) => {
                const Icon = FIELD_TYPE_ICON[f.type];
                const opts = splitChips(f.options, 14);
                return (
                  <li key={f.key} className="onb-prev__field">
                    <p className="onb-prev__fname">
                      <Icon aria-hidden="true" />
                      <span>{f.label}</span>
                      <span className="onb-prev__ftype">{t(`onboarding.field.${f.type}`)}</span>
                    </p>
                    {f.options.length > 0 ? (
                      <Chips>
                        {opts.shown.map((o) => (
                          <Chip key={o} variant="info">
                            {o}
                          </Chip>
                        ))}
                        {opts.more > 0 ? <Chip variant="info">{t('onboarding.preview.more', { n: opts.more })}</Chip> : null}
                      </Chips>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Group>
      ) : (
        <>
          {categories.length > 0 ? (
            <Group title={preview.fields.find((f) => f.role === 'category')?.label ?? ''}>
              <Chips>
                {catChips.shown.map((o) => (
                  <Chip key={o} variant="info">
                    {o}
                  </Chip>
                ))}
                {catChips.more > 0 ? <Chip variant="info">{t('onboarding.preview.more', { n: catChips.more })}</Chip> : null}
              </Chips>
            </Group>
          ) : null}
          {otherFields.length > 0 ? (
            <Group title={t('onboarding.preview.fields')}>
              <Chips>
                {otherFields.map((f) => (
                  <Chip key={f.key} variant="info" icon={FIELD_TYPE_ICON[f.type]}>
                    {f.label}
                  </Chip>
                ))}
              </Chips>
            </Group>
          ) : null}
        </>
      )}

      {full ? (
        <Group title={t('onboarding.preview.views')}>
          {preview.views.length === 0 ? (
            <p className="onb-prev__empty">{t('onboarding.preview.noViews')}</p>
          ) : (
            <ul className="onb-prev__views" role="list">
              {preview.views.map((v) => (
                <li key={v.key} className="onb-prev__view">
                  <span>{v.name}</span>
                  <span className="onb-prev__ftype">{t(`onboarding.view.${v.kind}`)}</span>
                </li>
              ))}
            </ul>
          )}
        </Group>
      ) : null}

      {!full && seeAllTo !== undefined ? (
        <Link to={seeAllTo} className="onb-prev__all">
          {t('onboarding.preview.seeAll')}
        </Link>
      ) : null}
    </div>
  );
}
