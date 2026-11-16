import { t } from "@/lib/i18n/t";
import type { PersonRecord } from "@/lib/skills/types";

/** "2026-12-01" → "01.12.2026" (Swiss format, no time-zone conversion). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

/** ISO date-time → "01.12.2026, 14:05" in the browser's time zone. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** FSM person types in plain words. The demo company has every technician twice (EMPLOYEE and ERPUSER). */
export function formatPersonType(type: string | null): string {
  if (type === "EMPLOYEE") return t("person.employee");
  if (type === "ERPUSER") return t("person.erpUser");
  if (type === "SALESEMPLOYEE") return t("person.salesEmployee");
  return type ?? "";
}

type PersonWithRecords = { id: string; records: PersonRecord[] };
const recordText = (person: PersonWithRecords, recordId: string) => t("person.record", { type: formatPersonType(person.records.find((r) => r.id === recordId)?.type ?? null) });

/** "on Employee record" when a skill sits on one of the person's linked records; "" for the main record. */
export function linkedRecordNote(person: PersonWithRecords, recordId: string): string {
  return recordId === person.id ? "" : t("person.onRecord", { record: recordText(person, recordId) });
}

/** "also on Employee record": the same skill is held by the person's other records too; "" if none. */
export function alsoOnNote(person: PersonWithRecords, recordIds: string[]): string {
  return recordIds.length ? t("person.alsoOnRecord", { records: recordIds.map((id) => recordText(person, id)).join(", ") }) : "";
}

/** File size for people: "640 KB" below 1 MB, otherwise "2.4 MB". */
export function formatFileSize(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb < 1 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${mb.toFixed(1)} MB`;
}
