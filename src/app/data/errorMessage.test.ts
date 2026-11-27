import { describe, expect, it } from 'vitest';
import { DomainError } from '../../core';
import { scoped, t } from '../../i18n';
import { errorMessage } from './errorMessage';

describe('errorMessage', () => {
  it('traduce un DomainError con errors.<code>', () => {
    expect(errorMessage(new DomainError('already_voided'), t)).toBe('Este movimiento ya está anulado.');
    expect(errorMessage(new DomainError('duplicate_label'), t)).toBe('Ya existe otro con ese nombre.');
  });
  it('un motivo con texto propio gana sobre el genérico del código', () => {
    expect(errorMessage(new DomainError('invalid_amount', { reason: 'workspace_total_too_large' }), t)).toMatch(/total del espacio/);
    expect(errorMessage(new DomainError('invalid_amount', { reason: 'otro' }), t)).toBe('El monto no es válido.');
  });
  it('un error cualquiera no enseña detalles técnicos', () => {
    const text = errorMessage(new Error('SQLITE_BUSY: database is locked'), t);
    expect(text).not.toContain('SQLITE');
    expect(text).toBe(t('common.error.unknown'));
  });
  it('un código de dominio sin traducción cae en el texto genérico', () => {
    const fake = new DomainError('not_found');
    Object.defineProperty(fake, 'code', { value: 'codigo_sin_traduccion' });
    expect(errorMessage(fake, t)).toBe(t('common.error.unknown'));
  });
  it('el texto genérico existe y no es la clave', () => {
    expect(t('common.error.unknown')).not.toMatch(/common\.error|⟦/);
    expect(scoped('common')('error.unknown')).toBe(t('common.error.unknown'));
  });
});
