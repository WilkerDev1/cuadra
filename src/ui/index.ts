// Sistema de diseño de Cuadra («Renglón y Resaltador»). Única entrada para features y shell.
// Importar este módulo carga los estilos (tokens, base y componentes).
import './styles.css';

// Utilidades
export { cx, cssColor, tintOf, supports, vibrate, closeTopLayer } from './lib';

// Primitivas
export { Button, IconButton, Spinner } from './primitives/Button';
export type { ButtonProps, ButtonVariant, IconButtonProps, SpinnerProps } from './primitives/Button';
export { Stack, Card, Banner, EmptyState, Skeleton } from './primitives/Layout';
export type { StackProps, CardProps, BannerProps, EmptyStateProps, SkeletonProps } from './primitives/Layout';
export { Chip, Segmented, Switch } from './primitives/Choice';
export type { ChipProps, SegmentedProps, SegmentedOption, SwitchProps } from './primitives/Choice';
export { Field, Input, Textarea, Select, Combobox, DateField, useFieldControl } from './primitives/Form';
export type { FieldProps, InputProps, TextareaProps, SelectProps, SelectOption, ComboboxProps, DateFieldProps } from './primitives/Form';
export { Sheet, Dialog, InfoTip, Menu } from './primitives/Overlay';
export type { SheetProps, DialogProps, InfoTipProps, MenuProps, MenuItem } from './primitives/Overlay';
export { ToastRegion, ToastProvider, useToast } from './primitives/Toast';
export type { ToastItem, ToastRegionProps } from './primitives/Toast';
export { ListRow, LedgerList, LedgerDay } from './primitives/ListRow';
export type { ListRowProps, RowAction, LedgerListProps, LedgerDayProps } from './primitives/ListRow';
export { Table } from './primitives/Table';
export type { TableProps, TableColumn } from './primitives/Table';

// Dominio
export { AmountText, MoneyText, DEFAULT_CURRENCY } from './domain/AmountText';
export type { AmountTextProps, MoneyTextProps, AmountSize } from './domain/AmountText';
export { AmountKeypad } from './domain/AmountKeypad';
export type { AmountKeypadProps, AmountKeypadHandle } from './domain/AmountKeypad';
export { Stamp, DoubleRule, Total, KindBadge, AccountChip, KIND_ICON, KIND_TONE, ACCOUNT_ICON } from './domain/Marks';
export type { StampProps, DoubleRuleProps, TotalProps, KindBadgeProps, AccountChipProps } from './domain/Marks';
export { FieldInput, FilterChips, PeriodPicker, FIELD_TYPE_ICON } from './domain/Filters';
export type { FieldInputProps, FilterChipsProps, ActiveFilter, PeriodPickerProps } from './domain/Filters';
export {
  amountParts,
  appendKey,
  evaluateExpression,
  formatExpression,
  sanitizePastedAmount,
  localeSeparators,
  MINUS,
} from './domain/amountLogic';
export type { AmountParts, AmountPartsOptions, AmountNotation, KeypadKey, EvalResult } from './domain/amountLogic';
export { numberToSpanishWords, spokenMoney } from './domain/spoken';

// Gráficas
export { Bars, Ladder, Ladder as Escalera, Line, Sparkline } from './charts/Charts';
export type { BarsProps, BarDatum, LadderProps, LineProps, LinePoint, SparklineProps } from './charts/Charts';
export { ladderSeries, niceCeil } from './charts/chartMath';
export type { DayFlow, LadderDay } from './charts/chartMath';
