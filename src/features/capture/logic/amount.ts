// El lector de montos escritos vive en `ui/domain/amountText` (lo usa también el pegado del teclado propio):
// una sola regla para toda la app, la de `Money.parse`.
export { exprFromMinor, MAX_FACTOR_DIGITS, parseAmountText, parseFactor, type AmountTextResult } from '../../../ui/domain/amountText';
