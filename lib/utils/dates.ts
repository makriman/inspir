const appDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const mediumDateFormatter = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
const longDateFormatter = new Intl.DateTimeFormat("en", { dateStyle: "long" });

function coerceDate(value: Date | string) {
  return typeof value === "string" ? new Date(value) : value;
}

export function formatAppDate(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = coerceDate(value);
  if (Number.isNaN(date.getTime())) return "";
  return appDateFormatter
    .format(date)
    .replace("AM", "am")
    .replace("PM", "pm");
}

export function formatMediumDate(value: Date | string) {
  return mediumDateFormatter.format(coerceDate(value));
}

export function formatLongDate(value: Date | string) {
  return longDateFormatter.format(coerceDate(value));
}
