import { getAssignmentStatus } from "@/lib/domain/status";
import { formatDate } from "@/lib/format";
import type { Assignment } from "@/lib/skills/types";
import { STATUS_DISPLAY } from "./statusDisplay";
import { t } from "@/lib/i18n/t";

/** Excel in Switzerland expects ";" between cells (the decimal comma is taken). */
const SEPARATOR = ";";
/** Characters that make Excel or LibreOffice read a cell as a formula (CSV injection), incl. full-width @. */
const FORMULA_START = /^[=+\-@＠\t\r]/;

/** One CSV cell: formulas defused with a leading apostrophe, then quoted if it holds ; " or a line break. */
export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * The matrix as CSV, exactly as shown: the given rows (current filters and "Show" choice) and the
 * given skill columns. The record column holds the type the screen shows (ERP user / Employee), so two
 * records of one person stay apart; it is always there, empty when the screen shows no type. Per skill: status, valid from, valid to, level and number of certificates.
 * UTF-8 with BOM so Excel shows umlauts; dates as dd.mm.yyyy.
 */
export function matrixCsv<P extends { id: string; name: string; jobTitle: string | null }>(
  persons: P[],
  recordType: (person: P) => string,
  skills: { id: string; name: string }[],
  lookup: (personId: string, tagId: string) => Assignment | undefined,
  certificateCount: (assignmentId: string) => number,
  today: string,
): string {
  const columns = [t("common.status"), t("common.validFrom"), t("common.validTo"), t("common.level"), t("common.certificates")];
  const header = [t("common.person"), t("csv.record"), t("csv.jobTitle"), ...skills.flatMap((s) => columns.map((column) => t("csv.column", { skill: s.name, column })))];
  const rows = persons.map((p) => [
    p.name,
    recordType(p),
    p.jobTitle ?? "",
    ...skills.flatMap((s) => {
      const a = lookup(p.id, s.id);
      if (!a) return [STATUS_DISPLAY.none.label, "", "", "", ""];
      return [STATUS_DISPLAY[getAssignmentStatus(a, today)].label, formatDate(a.startDate), formatDate(a.endDate), a.proficiencyName ?? "", String(certificateCount(a.id))];
    }),
  ]);
  return "﻿" + [header, ...rows].map((cells) => cells.map(csvCell).join(SEPARATOR)).join("\r\n");
}

export const csvFileName = (today: string) => `skill-matrix-${today}.csv`;

/** Hands the CSV to the browser as a download. */
export function downloadCsv(csv: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
