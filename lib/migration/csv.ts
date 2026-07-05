export type CsvRow = Record<string, string>;

export function parseCsv(input: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [headers, ...data] = rows;
  if (!headers) return [];
  return data
    .filter((entry) => entry.some((value) => value.trim()))
    .map((entry) =>
      Object.fromEntries(headers.map((header, index) => [header, entry[index] ?? ""])),
    );
}

export function duplicateAwareRows(rows: CsvRow[], preserveDuplicates: boolean) {
  if (preserveDuplicates) return { rows, skipped: 0 };
  const seen = new Set<string>();
  const deduped: CsvRow[] = [];
  let skipped = 0;

  for (const row of rows) {
    const key = JSON.stringify(row);
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }

  return { rows: deduped, skipped };
}
