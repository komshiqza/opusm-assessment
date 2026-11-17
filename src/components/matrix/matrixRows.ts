import { matchesJobTitles } from "@/lib/domain/jobTitleFilter";
import { t } from "@/lib/i18n/t";

/** The status counters above the table: the matrix's only status filter. */
export const COUNTER_STATUSES = ["expiring", "expired", "valid", "upcoming"] as const;
export type CounterStatus = (typeof COUNTER_STATUSES)[number];
export type StatusFilter = "all" | CounterStatus;

/**
 * The stored status filter as one the counters can show. Anything else (for example "none" from the
 * former Status dropdown, kept for the page's lifetime) means "all", so no filter stays active unseen.
 */
export function toStatusFilter(value: unknown): StatusFilter {
  return COUNTER_STATUSES.find((s) => s === value) ?? "all";
}

/** The matrix filters a row has to pass; the counters do not use them (they count the whole view). */
export interface MatrixRowFilter<S extends { id: string }> {
  /** Person search over the name only (the job title has its own filter), already trimmed and lower-case. */
  query: string;
  jobTitles: string[];
  /** "all", or a counter status one of the shown skills must have. */
  statusFilter: StatusFilter;
  /** The skill columns shown (the Skills filter). */
  skills: S[];
  statusOf: (personId: string, skillId: string) => string;
}

/** The rows the matrix shows; the CSV export and Bulk assign take exactly these. */
export function filterMatrixRows<P extends { id: string; name: string; jobTitle: string | null }, S extends { id: string }>(
  rows: P[],
  { query, jobTitles, statusFilter, skills, statusOf }: MatrixRowFilter<S>,
): P[] {
  return rows.filter((p) => {
    if (query && !p.name.toLowerCase().includes(query)) return false;
    if (!matchesJobTitles(p, jobTitles)) return false;
    if (statusFilter === "all") return true;
    return skills.some((s) => statusOf(p.id, s.id) === statusFilter);
  });
}

/** The table title with its item counter (Fiori table toolbar): "People (10)"; no counter when nothing is shown. */
export function peopleTitle(shown: number): string {
  return shown > 0 ? t("matrix.peopleCount", { n: shown }) : t("matrix.people");
}
