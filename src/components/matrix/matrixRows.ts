import { matchesJobTitles } from "@/lib/domain/jobTitleFilter";

/** The matrix filters a row has to pass; the counters do not use them (they count the whole view). */
export interface MatrixRowFilter<S extends { id: string }> {
  /** Person search over name and job title, already trimmed and lower-case. */
  query: string;
  jobTitles: string[];
  /** "all", or a status one of the shown skills must have. */
  statusFilter: string;
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
    if (query && !`${p.name} ${p.jobTitle ?? ""}`.toLowerCase().includes(query)) return false;
    if (!matchesJobTitles(p, jobTitles)) return false;
    if (statusFilter === "all") return true;
    return skills.some((s) => statusOf(p.id, s.id) === statusFilter);
  });
}
