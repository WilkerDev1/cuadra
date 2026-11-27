import { describe, expect, it } from 'vitest';
import { DomainError, ERROR_CODES, errorCodeFromMessage, isDomainError, isErrorCode, notImplemented } from './errors';
import { err, mapResult, ok, unwrap } from './result';
import es from '../i18n/es/errors';

describe('errors', () => {
  it('DomainError lleva código, detalles y nombre', () => {
    const e = new DomainError('opening_exists', { accountId: 'a' });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('DomainError');
    expect(e.message).toBe('opening_exists');
    expect(e.code).toBe('opening_exists');
    expect(e.details).toEqual({ accountId: 'a' });
  });

  it('isDomainError reconoce instancias y objetos que cruzaron un worker', () => {
    expect(isDomainError(new DomainError('not_found'))).toBe(true);
    expect(isDomainError(new DomainError('not_found'), 'not_found')).toBe(true);
    expect(isDomainError(new DomainError('not_found'), 'already_voided')).toBe(false);
    expect(isDomainError({ name: 'DomainError', code: 'delete_forbidden' }, 'delete_forbidden')).toBe(true);
    expect(isDomainError({ name: 'DomainError', code: 'nope' })).toBe(false);
    expect(isDomainError(new Error('not_found'))).toBe(false);
  });

  it('errorCodeFromMessage extrae el código de un RAISE de SQLite', () => {
    expect(errorCodeFromMessage('delete_forbidden')).toBe('delete_forbidden');
    expect(errorCodeFromMessage('SQLITE_CONSTRAINT_TRIGGER: seq_not_reserved')).toBe('seq_not_reserved');
    expect(errorCodeFromMessage('UNIQUE constraint failed: accounts.name')).toBeNull();
    expect(isErrorCode('immutable_column')).toBe(true);
    expect(isErrorCode('x')).toBe(false);
  });

  it('notImplemented lanza not_implemented con el método', () => {
    expect(() => notImplemented('fields.list')).toThrow(DomainError);
    try {
      notImplemented('fields.list');
    } catch (e) {
      expect(isDomainError(e, 'not_implemented')).toBe(true);
      expect((e as DomainError).details).toEqual({ method: 'fields.list' });
    }
  });

  it('cada ErrorCode tiene mensaje en español', () => {
    for (const code of ERROR_CODES) expect(es[`errors.${code}`], code).toBeTypeOf('string');
  });
});

describe('result', () => {
  it('ok, err, unwrap y mapResult', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err('x')).toEqual({ ok: false, error: 'x' });
    expect(unwrap(ok(2))).toBe(2);
    expect(() => unwrap(err('empty'))).toThrow('empty');
    expect(() => unwrap(err('empty'), (e) => new DomainError('invalid_amount', { reason: e }))).toThrow('invalid_amount');
    expect(mapResult(ok(2), (n) => n * 2)).toEqual({ ok: true, value: 4 });
    expect(mapResult(err('e'), (n: number) => n * 2)).toEqual({ ok: false, error: 'e' });
  });
});
