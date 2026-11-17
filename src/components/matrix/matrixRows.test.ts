import { describe, expect, it } from "vitest";
import { NO_JOB_TITLE } from "@/lib/domain/jobTitleFilter";
import { setRenderedLanguage } from "@/lib/i18n/language";
import { countStatuses, filterMatrixRows, heldElsewhere, isLockedRow, matrixRows, peopleTitle, recordLabel, toStatusFilter } from "./matrixRows";

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

describe("matrixRows (one row per person, or per FSM Person record with 'Show each FSM record')", () => {
  const anna = {
    id: "ANNA-ERP",
    name: "Anna Schneider",
    jobTitle: "Service Technician",
    refId: "ANNA-EMP",
    records: [
      { id: "ANNA-ERP", type: "ERPUSER" },
      { id: "ANNA-EMP", type: "EMPLOYEE" },
    ],
  };
  const admin = { id: "ADMIN", name: "admin", jobTitle: null, refId: "ADMIN", records: [{ id: "ADMIN", type: "EMPLOYEE" }] };

  it("off (the default view): one row per person, read through the person's cells", () => {
    const rows = matrixRows([anna, admin], false);
    expect(rows.map((r) => [r.id, r.name, r.record])).toEqual([
      ["ANNA-ERP", "Anna Schneider", undefined],
      ["ADMIN", "admin", undefined],
    ]);
    expect(rows.some(isLockedRow)).toBe(false);
  });

  it("on: one row per record, main record first, each with its type; only secondary records are locked", () => {
    const rows = matrixRows([anna, admin], true);
    expect(rows.map((r) => [r.id, r.person.id, r.record?.type, r.record?.main, isLockedRow(r)])).toEqual([
      ["ANNA-ERP", "ANNA-ERP", "ERPUSER", true, false],
      ["ANNA-EMP", "ANNA-ERP", "EMPLOYEE", false, true],
      ["ADMIN", "ADMIN", "EMPLOYEE", true, false],
    ]);
    // The person's job title and name stay on every record row, so the filters apply to them too.
    expect(filterMatrixRows(rows, { query: "", jobTitles: ["Service Technician"], statusFilter: "all", skills, statusOf }).map((r) => r.id)).toEqual(["ANNA-ERP", "ANNA-EMP"]);
  });

  it("labels a record row with its type; a secondary record says where skills are kept", () => {
    const [main, secondary, own] = matrixRows([anna, admin], true);
    expect(recordLabel(main)).toBe("ERP user");
    expect(recordLabel(secondary)).toBe("Employee · skills are kept on the ERP user record");
    expect(recordLabel(own)).toBe("Employee");
    expect(recordLabel(matrixRows([anna], false)[0])).toBe("");
    setRenderedLanguage("de");
    expect(recordLabel(secondary)).toBe("Mitarbeiter · Qualifikationen werden auf dem ERP-Benutzer-Eintrag geführt");
    setRenderedLanguage("en");
  });

  it("titles the table by what its rows are", () => {
    expect(peopleTitle(26, true)).toBe("Person records (26)");
    expect(peopleTitle(0, true)).toBe("Person records");
  });
});

describe("heldElsewhere (a main-record cell when the person holds the skill on a linked record)", () => {
  const anna = {
    id: "ANNA-ERP",
    name: "Anna Schneider",
    jobTitle: null,
    refId: "ANNA-EMP",
    records: [
      { id: "ANNA-ERP", type: "ERPUSER" },
      { id: "ANNA-EMP", type: "EMPLOYEE" },
    ],
  };
  const [personRow] = matrixRows([anna], false);
  const [mainRow, linkedRow] = matrixRows([anna], true);
  const onEmployee = { personId: "ANNA-EMP" };
  const onMain = { personId: "ANNA-ERP" };

  it.each([
    ["main record row, nothing on it, the skill on the Employee record", mainRow, undefined, onEmployee, onEmployee],
    ["main record row holding the skill itself", mainRow, onMain, onMain, undefined],
    ["main record row, the person has no such skill", mainRow, undefined, undefined, undefined],
    ["linked record row (read-only anyway)", linkedRow, undefined, onEmployee, undefined],
    ["person row (the cell already shows the person's skill)", personRow, onEmployee, onEmployee, undefined],
  ] as const)("%s", (_case, row, own, personsCell, expected) => {
    expect(heldElsewhere(row, own, personsCell)).toBe(expected);
  });
});
