export type CsvValue = string | number | null | undefined;

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => CsvValue;
};

const CSV_LINE_BREAK = "\r\n";
const UTF8_BOM = "﻿";

export function escapeCsvCell(value: CsvValue): string {
  if (value == null) return "";
  const text = typeof value === "number" ? String(value) : value;
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const header = columns.map((column) => escapeCsvCell(column.header)).join(",");
  const lines = rows.map((row) =>
    columns.map((column) => escapeCsvCell(column.value(row))).join(","),
  );
  return [header, ...lines].join(CSV_LINE_BREAK) + CSV_LINE_BREAK;
}

export function sanitizeFilenameSegment(value: string): string {
  return value
    .trim()
    .replace(/\//g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

export function buildReportCsvFilename({
  report,
  repoRef,
  from,
  to,
}: {
  report: string;
  repoRef?: string | null;
  from: string;
  to: string;
}): string {
  const segments = [report];
  const repo = repoRef ? sanitizeFilenameSegment(repoRef) : "";
  if (repo) segments.push(repo);
  segments.push(`${from}_to_${to}`);
  return `${segments.join("_")}.csv`;
}

export function downloadCsv(filename: string, csv: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([UTF8_BOM + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
