import { describe, expect, it } from "vitest";
import { buildPeople, placeAssignments } from "./persons";

/**
 * One row per real person, as SAP's UnifiedPerson does it: the Person records of one human share the
 * same refId (SAP's guaranteed key), so assignments are mapped by refId, not by assuming
 * UnifiedPerson.id = ERPUSER id. https://help.sap.com/docs/SAP_FIELD_SERVICE_MANAGEMENT/fsm_data_model/person-unifiedperson.html
 */
const unified = (id: string, refId: string, name: string, jobTitle: string | null = "Service Technician", inactive = false) => ({
  id,
  refId,
  name,
  jobTitle,
  inactive,
});
const record = (id: string, refId: string | null, type: string) => ({ id, refId, type });

// Anna: ERPUSER + EMPLOYEE (as in the demo company). UnifiedPerson id deliberately differs from the ERPUSER id.
const anna = unified("U-ANNA", "anna", "Anna Schneider");
const annaRecords = [record("anna-emp", "anna", "EMPLOYEE"), record("anna", "anna", "ERPUSER")];
// Eli: EMPLOYEE only, references itself.
const eli = unified("U-ELI", "eli", "Eli Brand", "Electrician");
const eliRecords = [record("eli", "eli", "EMPLOYEE")];
// Sam: ERPUSER + SALESEMPLOYEE.
const sam = unified("U-SAM", "sam", "Sam Roth", null);
const samRecords = [record("sam", "sam", "ERPUSER"), record("sam-sales", "sam", "SALESEMPLOYEE")];
// Ina: inactive in UnifiedPerson.
const ina = unified("U-INA", "ina", "Ina Alt", "Service Technician", true);
const inaRecords = [record("ina", "ina", "ERPUSER")];

const people = buildPeople([anna, eli, sam, ina], [...annaRecords, ...eliRecords, ...samRecords, ...inaRecords]);
const byName = (name: string) => people.find((p) => p.name === name)!;

describe("buildPeople (one row per real person, from UnifiedPerson)", () => {
  it("lists active people only, sorted by name", () => {
    expect(people.map((p) => p.name)).toEqual(["Anna Schneider", "Eli Brand", "Sam Roth"]);
  });

  it.each([
    ["Anna Schneider", "anna", ["anna", "anna-emp"], "ERPUSER + EMPLOYEE: the ERPUSER record is the main one (listed first)"],
    ["Eli Brand", "eli", ["eli"], "EMPLOYEE only: the record that references itself is the main one"],
    ["Sam Roth", "sam", ["sam", "sam-sales"], "ERPUSER + SALESEMPLOYEE: linked by refId"],
  ] as const)("%s → main record %s, records %j (%s)", (name, mainId, recordIds, _why) => {
    const person = byName(name);
    expect(person.id).toBe(mainId); // new assignments go to this record
    expect(person.records.map((r) => r.id)).toEqual(recordIds);
  });

  it("maps by refId, not by UnifiedPerson.id = ERPUSER id", () => {
    expect(byName("Anna Schneider").id).not.toBe(anna.id);
  });

  it("leaves out a person without any active Person record (nothing could be shown or written)", () => {
    expect(buildPeople([unified("U-X", "x", "Xaver")], [])).toEqual([]);
  });
});

describe("inactive Person records of an active person", () => {
  const rec = (id: string, refId: string, type: string, inactive: boolean) => ({ id, refId, type, inactive });

  it("keeps an inactive linked record (its skills stay visible and count as 'already has it')", () => {
    const [person] = buildPeople([unified("U-T", "tom", "Tom")], [rec("tom", "tom", "ERPUSER", false), rec("tom-emp", "tom", "EMPLOYEE", true)]);
    expect(person.records.map((r) => r.id)).toEqual(["tom", "tom-emp"]);
    expect(placeAssignments([person], [{ id: "S1", personId: "tom-emp", tagId: "AID" }]).byCell.get("tom|AID")?.id).toBe("S1");
  });

  it("never picks an inactive record as the main one (new assignments go there)", () => {
    const [person] = buildPeople([unified("U-V", "vera", "Vera")], [rec("vera", "vera", "ERPUSER", true), rec("vera-emp", "vera", "EMPLOYEE", false)]);
    expect(person.id).toBe("vera-emp");
  });

  it("leaves out a person whose records are all inactive (nothing could be written)", () => {
    expect(buildPeople([unified("U-W", "will", "Will")], [rec("will", "will", "ERPUSER", true)])).toEqual([]);
  });
});

describe("placeAssignments (each assignment in its person's cell)", () => {
  const a = (id: string, personId: string, tagId = "AID") => ({ id, personId, tagId });

  it.each([
    [[a("S1", "anna")], "anna", "S1", [], "skill on the main record"],
    [[a("S1", "anna-emp")], "anna", "S1", [], "skill only on the EMPLOYEE record: shown in her row"],
    [[a("S2", "anna-emp"), a("S1", "anna")], "anna", "S1", ["S2"], "same skill on both: the main record's is shown, the other is noted"],
    [[a("S1", "eli")], "eli", "S1", [], "EMPLOYEE-only person"],
    [[a("S1", "sam-sales")], "sam", "S1", [], "skill on a SALESEMPLOYEE record"],
  ] as const)("%j → cell %s shows %s, also %j (%s)", (assignments, personId, shown, also, _why) => {
    const cells = placeAssignments(people, [...assignments]);
    expect(cells.byCell.get(`${personId}|AID`)?.id).toBe(shown);
    expect((cells.alsoOn.get(`${personId}|AID`) ?? []).map((x) => x.id)).toEqual(also);
  });

  it("does not show an assignment whose technician is in no active person (inactive or unknown)", () => {
    const cells = placeAssignments(people, [a("S9", "ina"), a("S8", "nobody")]);
    expect(cells.byCell.size).toBe(0);
    expect(cells.ownerOf("ina")).toBeUndefined();
  });

  it("knows the person of every record, for the assignment's own record", () => {
    const cells = placeAssignments(people, []);
    expect(cells.ownerOf("anna-emp")?.id).toBe("anna");
    expect(cells.ownerOf("sam-sales")?.id).toBe("sam");
  });
});
