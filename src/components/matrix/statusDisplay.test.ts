import { describe, expect, it } from "vitest";
import { cellAction, compactStatusText, statusText } from "./statusDisplay";

const assignment = (startDate: string | null, endDate: string | null) => ({ startDate, endDate });

describe("compactStatusText (narrow matrix cells: icon plus a short date)", () => {
  it("shows the end date for valid, expiring and expired skills", () => {
    expect(compactStatusText("valid", assignment("2025-01-01", "2027-09-12"))).toBe("12.09.27");
    expect(compactStatusText("expiring", assignment(null, "2026-12-11"))).toBe("11.12.26");
    expect(compactStatusText("expired", assignment(null, "2026-11-13"))).toBe("13.11.26");
  });

  it("shows the start date for a skill that starts later", () => {
    expect(compactStatusText("upcoming", assignment("2027-01-01", null))).toBe("01.01.27");
  });

  it("says when a valid skill has no end date", () => {
    expect(compactStatusText("valid", assignment(null, null))).toBe("No end");
  });

  it("keeps the long text for wide screens", () => {
    expect(statusText("valid", assignment(null, "2027-09-12"))).toBe("Valid to 12.09.2027");
    expect(compactStatusText("none", null)).toBe("");
  });
});

describe("cellAction (a matrix cell or a phone-card line: what a click does)", () => {
  it.each([
    [true, false, "open", "a held skill on a main record"],
    [true, true, "open", "a held skill on a secondary record stays fully usable"],
    [false, false, "assign", "an empty cell on a main record"],
    [false, true, "assignOnMain", "an empty cell on a secondary record: no new skill here"],
  ] as const)("assigned %s, secondary %s → %s (%s)", (assigned, secondary, expected, _why) => {
    expect(cellAction(assigned, secondary)).toBe(expected);
  });
});
