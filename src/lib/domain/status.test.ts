import { describe, expect, it } from "vitest";
import { addDays, daysBetween, getAssignmentStatus, normalizeEndDate } from "./status";

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
  ] as const)("endDate %s → %s (%s)", (endDate, expected, _why) => {
    expect(getAssignmentStatus({ endDate }, TODAY)).toBe(expected);
  });

  it("returns 'none' when there is no assignment", () => {
    expect(getAssignmentStatus(null, TODAY)).toBe("none");
  });

  it.each([
    // [startDate, endDate, expected, why]
    ["2026-11-15", null, "valid", "started yesterday"],
    ["2026-11-16", null, "valid", "starts today"],
    ["2027-01-01", null, "upcoming", "starts later, no end date"],
    ["2026-11-20", "2026-12-01", "upcoming", "starts later, ends within 30 days: not valid yet comes first"],
    ["2027-01-01", "2028-01-01", "upcoming", "starts later, ends much later"],
    [null, "2026-12-01", "expiring", "no start date"],
  ] as const)("startDate %s, endDate %s → %s (%s)", (startDate, endDate, expected, _why) => {
    expect(getAssignmentStatus({ startDate, endDate }, TODAY)).toBe(expected);
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

describe("daysBetween", () => {
  it("counts calendar days, negative when the second date is earlier", () => {
    expect(daysBetween("2026-12-09", "2026-12-15")).toBe(6);
    expect(daysBetween("2026-12-15", "2026-12-09")).toBe(-6);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2); // across the DST change
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
