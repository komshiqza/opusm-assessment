import { describe, expect, it } from "vitest";
import { countPhysicalPersons, personsWithoutJobTitle, recordsNeedingType, secondaryRecordIds, selectPersonRows } from "./persons";

/** Records as SAP links them: every record's refId is the id of the ERPUSER record (which references itself). */
const record = (id: string, type: string, refId: string, jobTitle: string | null = "Service Technician") => ({ id, type, refId, jobTitle });

// Marco: two linked records (as in the demo company)
const marcoErp = record("marco", "ERPUSER", "marco");
const marcoEmployee = record("marco-emp", "EMPLOYEE", "marco");
// Anna: three linked records (ERPUSER, EMPLOYEE, SALESEMPLOYEE)
const annaErp = record("anna", "ERPUSER", "anna");
const annaEmployee = record("anna-emp", "EMPLOYEE", "anna");
const annaSales = record("anna-sales", "SALESEMPLOYEE", "anna");
// Lukas: a technician without any of our skills, only the ERPUSER record
const lukasErp = record("lukas", "ERPUSER", "lukas");
// Dominic: no job title on any record (not a technician)
const dominicErp = record("dominic", "ERPUSER", "dominic", null);
const dominicEmployee = record("dominic-emp", "EMPLOYEE", "dominic", null);
// Eva: only the EMPLOYEE record carries the job title
const evaErp = record("eva", "ERPUSER", "eva", null);
const evaEmployee = record("eva-emp", "EMPLOYEE", "eva");

const all = [marcoErp, marcoEmployee, annaErp, annaEmployee, annaSales, lukasErp, dominicErp, dominicEmployee, evaErp, evaEmployee];

describe("selectPersonRows (SAP: records linked by refId; the person is the ERPUSER record)", () => {
  it("shows one row per technician: the ERPUSER record of each linked group with a job title", () => {
    expect(selectPersonRows(all, new Set(), false).map((p) => p.id)).toEqual(["marco", "anna", "lukas", "eva"]);
  });

  it("shows a technician who has none of our skills", () => {
    expect(selectPersonRows([lukasErp], new Set(), false)).toEqual([lukasErp]);
  });

  it("hides people without a job title on any record", () => {
    expect(selectPersonRows([dominicErp, dominicEmployee], new Set(), false)).toEqual([]);
  });

  it("never hides a record that holds one of our skills", () => {
    const rows = selectPersonRows(all, new Set(["anna-sales", "dominic-emp"]), false).map((p) => p.id);
    expect(rows).toEqual(["marco", "anna", "anna-sales", "lukas", "dominic-emp", "eva"]);
  });

  it("falls back to the first record when a group has no ERPUSER record", () => {
    const orphan = record("x-emp", "EMPLOYEE", "x");
    expect(selectPersonRows([orphan], new Set(), false)).toEqual([orphan]);
  });

  it("shows every record when asked", () => {
    expect(selectPersonRows(all, new Set(), true)).toEqual(all);
  });
});

describe("countPhysicalPersons", () => {
  it("counts linked groups, not records", () => {
    expect(countPhysicalPersons(all)).toBe(5);
  });
});

describe("personsWithoutJobTitle", () => {
  it("marks every record of a person whose linked records have no job title", () => {
    expect([...personsWithoutJobTitle(all)].sort()).toEqual(["dominic", "dominic-emp"]);
  });

  it("does not mark a person whose job title sits on another linked record", () => {
    expect(personsWithoutJobTitle(all).has("eva")).toBe(false);
  });
});

describe("recordsNeedingType (\"ERP user\" etc. only where it tells rows apart)", () => {
  it("shows no record type when every person has one row", () => {
    expect(recordsNeedingType([marcoErp, annaErp, lukasErp])).toEqual(new Set());
  });

  it("shows the record type on two rows of the same person", () => {
    expect(recordsNeedingType([marcoErp, annaErp, annaSales])).toEqual(new Set(["anna", "anna-sales"]));
  });

  it("does not count the same record twice (e.g. one row per assignment in the expiry list)", () => {
    expect(recordsNeedingType([annaErp, annaErp, marcoErp])).toEqual(new Set());
  });
});

describe("secondaryRecordIds (new skills only on a person's main record)", () => {
  const plain = (id: string, type: string, refId: string | null) => ({ id, type, refId, jobTitle: "Service Technician" });
  const loaded = [
    plain("U", "ERPUSER", "U"),
    plain("E", "EMPLOYEE", "U"), // linked to a loaded ERPUSER
    plain("S", "SALESEMPLOYEE", "U"), // linked to a loaded ERPUSER
    plain("SELF", "EMPLOYEE", "SELF"), // refId to itself: its own person
    plain("NOREF", "EMPLOYEE", null), // no refId: its own person
    plain("LOST", "EMPLOYEE", "NOT-LOADED"), // refId to a person that is not loaded
    plain("TOEMP", "EMPLOYEE", "SELF"), // refId to a record that is not an ERPUSER
    { id: "ADMIN", type: "ERPUSER", refId: "ADMIN", jobTitle: null }, // ERPUSER without a job title
  ];
  const secondary = secondaryRecordIds(loaded);

  it.each([
    ["U", false, "an ERPUSER record"],
    ["E", true, "an EMPLOYEE linked to a loaded ERPUSER"],
    ["S", true, "a SALESEMPLOYEE linked to a loaded ERPUSER"],
    ["SELF", false, "an EMPLOYEE whose refId is itself"],
    ["NOREF", false, "an EMPLOYEE without a refId"],
    ["LOST", false, "an EMPLOYEE whose refId is not loaded"],
    ["TOEMP", false, "an EMPLOYEE whose refId is not an ERPUSER"],
    ["ADMIN", false, "an ERPUSER without a job title"],
  ] as const)("%s → secondary %s (%s)", (id, expected, _why) => {
    expect(secondary.has(id)).toBe(expected);
  });

  it("works on the demo company's pairs", () => {
    expect([...secondaryRecordIds(all)].sort()).toEqual(["anna-emp", "anna-sales", "dominic-emp", "eva-emp", "marco-emp"]);
  });
});
