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
  if (type === "EMPLOYEE") return "Employee";
  if (type === "ERPUSER") return "ERP user";
  return type ?? "";
}

/** File size for people: "640 KB" below 1 MB, otherwise "2.4 MB". */
export function formatFileSize(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb < 1 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${mb.toFixed(1)} MB`;
}
