import Papa from "papaparse";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 50_000;

export type ParsedCsv = {
  headers: string[];
  /** Each row keyed by header. Row numbers are 1-based data rows (header excluded) + 1, i.e. the spreadsheet line. */
  rows: { line: number; values: Record<string, string> }[];
  delimiter: string;
  truncated: boolean;
};

export class CsvError extends Error {}

/** Parse CSV text (comma, semicolon or tab separated) into header-keyed rows. */
export function parseCsv(text: string): ParsedCsv {
  if (text.length > MAX_IMPORT_BYTES * 1.1) throw new CsvError("File is larger than 5 MB");
  if (text.includes("\u0000")) throw new CsvError("This does not look like a text CSV file");
  const clean = text.replace(/^﻿/, "");
  // Track the physical line each record starts on so errors point at the right spreadsheet row.
  const data: string[][] = [];
  const lines: number[] = [];
  let pos = 0;
  let line = 1;
  let delimiter = ",";
  Papa.parse<string[]>(clean, {
    skipEmptyLines: "greedy",
    delimitersToGuess: [",", ";", "\t", "|"],
    step: (res) => {
      while (pos < clean.length && (clean[pos] === "\n" || clean[pos] === "\r")) {
        if (clean[pos] === "\n") line++;
        pos++;
      }
      lines.push(line);
      data.push(res.data);
      delimiter = res.meta.delimiter;
      const end = Math.min(res.meta.cursor, clean.length);
      for (; pos < end; pos++) if (clean[pos] === "\n") line++;
    },
  });
  if (data.length === 0) throw new CsvError("The file is empty");
  const seen = new Map<string, number>();
  const headers = data[0].map((h, i) => {
    const base = (h ?? "").trim() || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
  if (headers.length < 2) throw new CsvError("Could not detect columns. Use a comma, semicolon or tab separated file with a header row.");
  const body = data.slice(1);
  const truncated = body.length > MAX_IMPORT_ROWS;
  const rows = body.slice(0, MAX_IMPORT_ROWS).map((cells, i) => {
    const values: Record<string, string> = {};
    headers.forEach((h, j) => (values[h] = (cells[j] ?? "").trim()));
    return { line: lines[i + 1], values };
  });
  return { headers, rows, delimiter, truncated };
}
