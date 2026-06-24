// Minimal dependency-free CSV parser for outbound recipient lists. Handles
// quoted fields, embedded commas/newlines, and "" escaped quotes. Returns the
// header row + an array of row objects keyed by header.

export type CsvParseResult = { headers: string[]; rows: Record<string, string>[] };

export function parseCsv(text: string): CsvParseResult {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // Ignore fully-empty trailing lines.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ",") pushField();
    else if (c === "\n") pushRow();
    else if (c === "\r") {
      /* skip; handled by \n */
    } else field += c;
  }
  // Flush the final field/row if the file doesn't end with a newline.
  if (field !== "" || row.length) pushRow();

  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (rows[r][idx] ?? "").trim();
    });
    out.push(obj);
  }
  return { headers, rows: out };
}

// Best-effort guess at which column holds the phone number, so the UI can
// pre-select it (the user can still override).
export function guessNumberColumn(headers: string[]): string | null {
  const norm = headers.map((h) => ({ h, k: h.toLowerCase().replace(/[^a-z]/g, "") }));
  const exact = norm.find((x) => ["number", "phone", "mobile", "tel", "telephone", "phonenumber"].includes(x.k));
  if (exact) return exact.h;
  const partial = norm.find((x) => /(phone|mobile|number|tel)/.test(x.k));
  return partial?.h ?? null;
}

export function guessNameColumn(headers: string[]): string | null {
  const norm = headers.map((h) => ({ h, k: h.toLowerCase().replace(/[^a-z]/g, "") }));
  const exact = norm.find((x) => ["name", "firstname", "fullname", "contact", "contactname"].includes(x.k));
  if (exact) return exact.h;
  const partial = norm.find((x) => /name/.test(x.k));
  return partial?.h ?? null;
}

// Replace {{token}} placeholders (case-insensitive, whitespace-tolerant) with a
// recipient's merge fields. Unknown tokens collapse to an empty string. Shared
// by the server (per-recipient render at blast creation) and the client (live
// preview), so it lives here rather than in the "use server" actions module.
export function renderObjective(template: string, fields: Record<string, string>): string {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) lower[k.toLowerCase().trim()] = v ?? "";
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_match, token: string) => {
    const key = String(token).toLowerCase().trim();
    return lower[key] ?? "";
  });
}
