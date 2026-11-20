import { appLocale } from "@/shared/lib/locale.ts";

const SHORT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
};

function toValidDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "N/A";
  return toValidDate(value)?.toLocaleDateString(appLocale(), SHORT_DATE_OPTIONS) ?? "Invalid Date";
}

/** A day and time, short, as a label is written: "12 Nov, 08:00". */
export function formatShortDateTime(value: string): string {
  return (
    toValidDate(value)?.toLocaleString(appLocale(), {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) ?? ""
  );
}

/** A day of the year, short, as on a label: "12 Nov". */
export function formatMonthDay(value: string): string {
  return (
    toValidDate(value)?.toLocaleDateString(appLocale(), { month: "short", day: "numeric" }) ?? ""
  );
}

/** The time of day of `epochMs`, as a clock shows it: "21:04". */
export function formatClockTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(appLocale(), { hour: "2-digit", minute: "2-digit" });
}
