import { describe, expect, it } from "vitest";
import { addDays, getAssignmentStatus, normalizeEndDate } from "./status";

const TODAY = "2026-11-16";

describe("getAssignmentStatus", () => {
  it.each([
    // [endDate, expected, why]
    [null, "valid", "no end date"],
    ["2027-06-01", "valid", "far in the future"],
    ["2026-12-17", "valid", "31 days away"],
    ["2026-12-16", "expiring", "exactly 30 days away"],
    ["2026-11-17", "expiring", "tomorrow"],
    ["2026-11-16", "expiring", "ends today (still valid until end of day)"],
    ["2026-11-15", "expired", "ended yesterday"],
    ["2020-01-01", "expired", "long ago"],
  ] as const)("endDate %s → %s (%s)", (endDate, expected) => {
    expect(getAssignmentStatus({ endDate }, TODAY)).toBe(expected);
  });

  it("returns 'none' when there is no assignment", () => {
    expect(getAssignmentStatus(null, TODAY)).toBe("none");
  });

  it("works across a year boundary", () => {
    expect(getAssignmentStatus({ endDate: "2027-01-10" }, "2026-12-20")).toBe("expiring");
    // 20 Dec + 30 days = 19 Jan
    expect(getAssignmentStatus({ endDate: "2027-01-19" }, "2026-12-20")).toBe("expiring");
    expect(getAssignmentStatus({ endDate: "2027-01-20" }, "2026-12-20")).toBe("valid");
  });
});

describe("normalizeEndDate", () => {
  it("treats the Skill Service open end 9999-12-31 as no end date", () => {
    expect(normalizeEndDate("9999-12-31")).toBeNull();
  });
  it("keeps real dates and null", () => {
    expect(normalizeEndDate("2027-03-01")).toBe("2027-03-01");
    expect(normalizeEndDate(null)).toBeNull();
    expect(normalizeEndDate("")).toBeNull();
  });
});

describe("addDays", () => {
  it("adds days in calendar terms, including month, leap-year and DST changes", () => {
    expect(addDays("2026-11-16", 30)).toBe("2026-12-16");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
  });
});
