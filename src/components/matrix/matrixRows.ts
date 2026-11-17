import { matchesJobTitles } from "@/lib/domain/jobTitleFilter";
import { formatPersonType } from "@/lib/format";
import { t } from "@/lib/i18n/t";
import type { Person } from "@/lib/skills/types";

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

/** The matrix filters a row has to pass; the counters use all but the status filter. */
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

/** How many cells of each counter status the counters show. */
export type StatusCounts = Record<CounterStatus, number>;

/**
 * The status counters: cells of the people shown (name search and Job title filter) over the skills
 * shown. Never filtered by the status itself, so clicking one counter keeps the others and the user
 * can switch between them.
 */
export function countStatuses<P extends { id: string; name: string; jobTitle: string | null }, S extends { id: string }>(
  rows: P[],
  filter: Omit<MatrixRowFilter<S>, "statusFilter">,
): StatusCounts {
  const counts: StatusCounts = { expiring: 0, expired: 0, valid: 0, upcoming: 0 };
  for (const p of filterMatrixRows(rows, { ...filter, statusFilter: "all" })) {
    for (const s of filter.skills) {
      const status = toStatusFilter(filter.statusOf(p.id, s.id));
      if (status !== "all") counts[status]++;
    }
  }
  return counts;
}

/** The table title with its item counter (Fiori table toolbar): "People (10)"; no counter when nothing is shown. */
export function peopleTitle(shown: number, records = false): string {
  if (records) return shown > 0 ? t("matrix.recordCount", { n: shown }) : t("matrix.records");
  return shown > 0 ? t("matrix.peopleCount", { n: shown }) : t("matrix.people");
}

/**
 * One matrix row. By default one per person; with "Show each FSM record" one per FSM Person record
 * (a person has up to three, see src/lib/domain/persons.ts), so the matrix can be seen with 25+ rows.
 */
export interface MatrixRow {
  /** The id the row's cells are read by: the person's main record (person rows), else this record. */
  id: string;
  name: string;
  jobTitle: string | null;
  person: Person;
  /** Record rows only: this record's type, whether it is the person's main record, and the main record's type. */
  record?: { type: string | null; main: boolean; mainType: string | null };
}

/** The rows of the matrix: people, or each person's records (main record first, as the person lists them). */
export function matrixRows(people: Person[], eachRecord: boolean): MatrixRow[] {
  if (!eachRecord) return people.map((p) => ({ id: p.id, name: p.name, jobTitle: p.jobTitle, person: p }));
  return people.flatMap((p) => {
    const mainType = p.records.find((r) => r.id === p.id)?.type ?? null;
    return p.records.map((r) => ({ id: r.id, name: p.name, jobTitle: p.jobTitle, person: p, record: { type: r.type, main: r.id === p.id, mainType } }));
  });
}

/** A linked record (not the person's main one): new skills never go there, so its row is read-only. */
export const isLockedRow = (row: MatrixRow): boolean => row.record !== undefined && !row.record.main;

/** "ERP user"; on a linked record also where the person's skills are kept. "" for person rows. */
export function recordLabel(row: MatrixRow): string {
  if (!row.record) return "";
  const type = formatPersonType(row.record.type);
  if (!isLockedRow(row)) return type;
  return `${type} · ${t("matrix.mainRecordNote", { record: t("person.record", { type: formatPersonType(row.record.mainType) }) })}`;
}

/**
 * On a main-record row: the assignment the person holds on a linked record when this record holds none.
 * A second one can never be created (one skill per person), so that cell opens the existing one instead
 * of offering "Assign". undefined everywhere else.
 */
export function heldElsewhere<A extends { personId: string }>(row: MatrixRow, own: A | undefined, personsCell: A | undefined): A | undefined {
  if (!row.record?.main || own || !personsCell) return undefined;
  return personsCell.personId === row.id ? undefined : personsCell;
}
