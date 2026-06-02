const dateOnlyPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function calculateAge(dateOfBirth: string | null | undefined, now = new Date()) {
  const parts = parseDateOnly(dateOfBirth);
  if (!parts) return null;

  const today = {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
    day: now.getUTCDate(),
  };
  let age = today.year - parts.year;
  if (today.month < parts.month || (today.month === parts.month && today.day < parts.day)) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function normalizeDateOfBirth(input: unknown) {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return parseDateOnly(trimmed) ? trimmed : null;
}

export function validateDateOfBirth(input: unknown, now = new Date()) {
  const normalized = normalizeDateOfBirth(input);
  if (!normalized) {
    return { success: false as const, error: "Enter a valid date of birth." };
  }

  const parts = parseDateOnly(normalized);
  if (!parts) {
    return { success: false as const, error: "Enter a valid date of birth." };
  }

  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dobUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  if (dobUtc > todayUtc) {
    return { success: false as const, error: "Date of birth cannot be in the future." };
  }

  return { success: true as const, value: normalized };
}

function parseDateOnly(value: string | null | undefined) {
  if (!value) return null;
  const match = dateOnlyPattern.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}
