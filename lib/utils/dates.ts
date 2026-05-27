export function formatBubbleDate(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(date)
    .replace("AM", "am")
    .replace("PM", "pm");
}

export function parseBubbleDate(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) return direct;
  const normalized = trimmed.replace(" UTC", "Z").replace(" at ", " ");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
