import { describe, expect, it } from "vitest";
import { alsoOnNote, linkedRecordNote } from "./format";

describe("linkedRecordNote / alsoOnNote (where a person's skill sits)", () => {
  const anna = { id: "anna", records: [{ id: "anna", type: "ERPUSER" }, { id: "anna-emp", type: "EMPLOYEE" }, { id: "anna-sales", type: "SALESEMPLOYEE" }] };

  it("says nothing for the main record", () => {
    expect(linkedRecordNote(anna, "anna")).toBe("");
  });

  it("names a linked record", () => {
    expect(linkedRecordNote(anna, "anna-emp")).toBe("on Employee record");
    expect(linkedRecordNote(anna, "anna-sales")).toBe("on Sales employee record");
  });

  it("names the other records that hold the same skill too", () => {
    expect(alsoOnNote(anna, [])).toBe("");
    expect(alsoOnNote(anna, ["anna-emp"])).toBe("also on Employee record");
    expect(alsoOnNote(anna, ["anna-emp", "anna-sales"])).toBe("also on Employee record, Sales employee record");
  });
});
