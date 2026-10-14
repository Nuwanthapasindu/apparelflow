// One timezone constant for every displayed time. Times are stored in UTC; the plant's local time
// is a display concern. Fixed locale and zone also keep server and client output identical, which
// avoids hydration mismatches.
export const APP_TIMEZONE = "Asia/Colombo";
const LOCALE = "en-GB";

const dateTime = new Intl.DateTimeFormat(LOCALE, { timeZone: APP_TIMEZONE, dateStyle: "medium", timeStyle: "short" });

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "-" : dateTime.format(date);
}

export function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}
