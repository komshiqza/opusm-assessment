import { describe, expect, it } from "vitest";
import { NO_JOB_TITLE } from "@/lib/domain/jobTitleFilter";
import { countStatuses, filterMatrixRows, peopleTitle, toStatusFilter } from "./matrixRows";

const rows = [
  { id: "anna", name: "Anna Schneider", jobTitle: "Service Technician" },
  { id: "eli", name: "Eli Brand", jobTitle: "Electrician" },
  { id: "dora", name: "Dora Keller", jobTitle: "Dispatcher" },
  { id: "admin", name: "admin", jobTitle: null },
];
const skills = [{ id: "AID" }, { id: "WELD" }];
const statuses: Record<string, string> = { "anna|AID": "expired", "eli|WELD": "expired", "dora|AID": "valid" };
const statusOf = (personId: string, skillId: string) => statuses[`${personId}|${skillId}`] ?? "none";
const ids = (filter: Partial<Parameters<typeof filterMatrixRows>[1]>) =>
  filterMatrixRows(rows, { query: "", jobTitles: [], statusFilter: "all", skills, statusOf, ...filter }).map((p) => p.id);

describe("filterMatrixRows (the rows the matrix, the CSV export and Bulk assign get)", () => {
  it("keeps every row with no filter set", () => {
    expect(ids({})).toEqual(["anna", "eli", "dora", "admin"]);
  });

  it("searches names only: the job title has its own filter", () => {
    expect(ids({ query: "eli" })).toEqual(["eli"]);
    expect(ids({ query: "electrician" })).toEqual([]);
  });

  it("filters by several job titles", () => {
    expect(ids({ jobTitles: ["Electrician", "Dispatcher"] })).toEqual(["eli", "dora"]);
  });

  it("filters by 'No job title'", () => {
    expect(ids({ jobTitles: [NO_JOB_TITLE] })).toEqual(["admin"]);
  });

  it("combines the job title with the person search", () => {
    expect(ids({ jobTitles: ["Electrician", "Dispatcher"], query: "dora" })).toEqual(["dora"]);
    expect(ids({ jobTitles: ["Electrician"], query: "anna" })).toEqual([]);
  });

  it("combines the job title with the status, over the skills shown", () => {
    expect(ids({ jobTitles: ["Service Technician", "Electrician"], statusFilter: "expired" })).toEqual(["anna", "eli"]);
    // With only First aid shown, Eli's expired Welding no longer counts.
    expect(ids({ jobTitles: ["Service Technician", "Electrician"], statusFilter: "expired", skills: [{ id: "AID" }] })).toEqual(["anna"]);
  });
});

describe("countStatuses (the status counters count the people shown, not the status filter)", () => {
  const counts = (filter: Partial<Parameters<typeof countStatuses>[1]>) => countStatuses(rows, { query: "", jobTitles: [], skills, statusOf, ...filter });

  it("counts every row with no filter set", () => {
    expect(counts({})).toEqual({ expiring: 0, expired: 2, valid: 1, upcoming: 0 });
  });

  it("ignores people the Job title filter hides", () => {
    // Dora (Dispatcher, valid First aid) and Eli (Electrician, expired Welding) are hidden.
    expect(counts({ jobTitles: ["Service Technician"] })).toEqual({ expiring: 0, expired: 1, valid: 0, upcoming: 0 });
  });

  it("ignores people the name search hides", () => {
    expect(counts({ query: "dora" })).toEqual({ expiring: 0, expired: 0, valid: 1, upcoming: 0 });
  });

  it("counts only the skills shown", () => {
    expect(counts({ skills: [{ id: "WELD" }] })).toEqual({ expiring: 0, expired: 1, valid: 0, upcoming: 0 });
  });

  it("does not depend on the status filter: clicking a counter keeps the others, so the user can switch", () => {
    const filter = { query: "", jobTitles: ["Service Technician", "Dispatcher"], skills, statusOf };
    const withStatus = { ...filter, statusFilter: "expired" } as Parameters<typeof countStatuses>[1];
    expect(countStatuses(rows, withStatus)).toEqual(countStatuses(rows, filter));
    expect(countStatuses(rows, filter)).toEqual({ expiring: 0, expired: 1, valid: 1, upcoming: 0 });
  });
});

describe("toStatusFilter (the stored counter filter; the counters are the only status filter)", () => {
  it.each(["expiring", "expired", "valid", "upcoming"] as const)("keeps the counter status %s", (status) => {
    expect(toStatusFilter(status)).toBe(status);
  });

  it("falls back to all for a stale 'none' from the removed Status dropdown: no hidden filter stays active", () => {
    expect(toStatusFilter("none")).toBe("all");
  });

  it.each([["all"], [undefined], [""], ["unknown"]])("reads %s as all", (value) => {
    expect(toStatusFilter(value)).toBe("all");
  });
});

describe("peopleTitle (the title of the matrix table: Fiori title with item counter)", () => {
  it("counts the rows shown now", () => {
    expect(peopleTitle(13)).toBe("People (13)");
    expect(peopleTitle(1)).toBe("People (1)");
  });

  it("drops the counter when no row is shown", () => {
    expect(peopleTitle(0)).toBe("People");
  });
});
