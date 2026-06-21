import * as React from 'react';
import DatePicker, { DateObject } from 'react-multi-date-picker';
import persian from 'react-date-object/calendars/persian';
import persian_fa from 'react-date-object/locales/persian_fa';
import gregorian from 'react-date-object/calendars/gregorian';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { useTranslation } from '@/hooks/useTranslation';

/**
 * A locale-aware date input.
 *
 * For Persian (`fa`) it renders a **Jalali/Shamsi** calendar picker; for every
 * other language it falls back to the native `<input type="date">`. Regardless
 * of the calendar shown to the user, the `value` it reads and the value it
 * emits via `onChange` are always **Gregorian `YYYY-MM-DD`** strings — the same
 * shape a native date input uses — so callers and the backend are unaffected.
 */
export interface DateFieldProps {
  /** Gregorian `YYYY-MM-DD` (or empty string). */
  value: string;
  /** Receives a Gregorian `YYYY-MM-DD` (or empty string when cleared). */
  onChange: (value: string) => void;
  id?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  /** Gregorian `YYYY-MM-DD`. */
  min?: string;
  /** Gregorian `YYYY-MM-DD`. */
  max?: string;
  className?: string;
  placeholder?: string;
}

const INPUT_CLASS =
  'tm-input flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

/** Format a JS Date to a Gregorian `YYYY-MM-DD` using its local date parts. */
function toIsoDate(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse a Gregorian `YYYY-MM-DD` into a local-midnight Date (avoids UTC shift). */
function fromIsoDate(value: string | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export const DateField: React.FC<DateFieldProps> = ({
  value,
  onChange,
  id,
  name,
  disabled,
  required,
  min,
  max,
  className,
  placeholder,
}) => {
  const { language, isRTL } = useTranslation();

  if (language !== 'fa') {
    return (
      <Input
        id={id}
        name={name}
        type="date"
        value={value ?? ''}
        disabled={disabled}
        required={required}
        min={min}
        max={max}
        className={className}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  const selected = fromIsoDate(value);

  return (
    <DatePicker
      id={id}
      name={name}
      calendar={persian}
      locale={persian_fa}
      calendarPosition={isRTL ? 'bottom-right' : 'bottom-left'}
      portal
      format="YYYY/MM/DD"
      value={selected ? new DateObject({ date: selected, calendar: gregorian }).convert(persian) : ''}
      minDate={fromIsoDate(min) ?? undefined}
      maxDate={fromIsoDate(max) ?? undefined}
      disabled={disabled}
      required={required}
      inputClass={cn(INPUT_CLASS, className)}
      containerClassName="w-full"
      placeholder={placeholder}
      onChange={(date: DateObject | null) => {
        onChange(date ? toIsoDate(date.toDate()) : '');
      }}
    />
  );
};

export default DateField;
