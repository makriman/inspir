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

export function parseAppDate(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) return direct;
  const normalized = trimmed.replace(" UTC", "Z").replace(" at ", " ");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
