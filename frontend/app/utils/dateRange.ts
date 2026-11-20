import type { DateRange } from "react-day-picker";

const DEFAULT_DATE_RANGE_DAYS = 30;

export type DefinedDateRange = DateRange & {
  from: Date;
  to: Date;
};

const padNumber = (value: number) => value.toString().padStart(2, "0");

export const formatDateForQuery = (date: Date): string => {
  return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
};

export const parseDateParam = (value: string | null): Date | undefined => {
  if (!value) return undefined;
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return undefined;
  }
  return new Date(year, month - 1, day);
};

export const getDefaultDateRange = (days = DEFAULT_DATE_RANGE_DAYS): DefinedDateRange => {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  return { from, to };
};

export const getDateRangeFromSearchParams = (
  searchParams: URLSearchParams,
  days = DEFAULT_DATE_RANGE_DAYS,
): DefinedDateRange => {
  const defaults = getDefaultDateRange(days);
  const from = parseDateParam(searchParams.get("startDate")) ?? defaults.from;
  const to = parseDateParam(searchParams.get("endDate")) ?? defaults.to;
  return { from, to };
};

export const isSameDay = (a?: Date, b?: Date): boolean => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};

export const isSameDateRange = (a: DateRange, b: DateRange): boolean => {
  return isSameDay(a.from, b.from) && isSameDay(a.to, b.to);
};
