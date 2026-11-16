import { describe, expect, it } from "vitest";
import { isTechnicianRecord, selectPersonRows } from "./persons";

const person = (id: string, type: string | null, jobTitle: string | null) => ({ id, name: id, type, jobTitle });

// Shapes as they exist in the demo company (16.11.2026).
const marcoErp = person("marco-erp", "ERPUSER", "Service Technician");
const marcoEmployee = person("marco-emp", "EMPLOYEE", "Service Technician");
const dominicErp = person("dominic-erp", "ERPUSER", null); // OPUSm staff, no job title
const admin = person("admin", "ERPUSER", null);
const unnamed = person("unnamed", "EMPLOYEE", null);
const all = [marcoErp, marcoEmployee, dominicErp, admin, unnamed];

describe("isTechnicianRecord", () => {
  it("is the ERP user record with a job title", () => {
    expect(isTechnicianRecord(marcoErp)).toBe(true);
    expect(isTechnicianRecord(marcoEmployee)).toBe(false);
    expect(isTechnicianRecord(dominicErp)).toBe(false);
    expect(isTechnicianRecord(admin)).toBe(false);
  });
});

describe("selectPersonRows", () => {
  it("shows one row per technician by default", () => {
    expect(selectPersonRows(all, new Set(), false)).toEqual([marcoErp]);
  });

  it("never hides a record that holds one of our skills", () => {
    expect(selectPersonRows(all, new Set(["marco-emp", "admin"]), false)).toEqual([marcoErp, marcoEmployee, admin]);
  });

  it("shows every record when asked", () => {
    expect(selectPersonRows(all, new Set(), true)).toEqual(all);
  });
});
