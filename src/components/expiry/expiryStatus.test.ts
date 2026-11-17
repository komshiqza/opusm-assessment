import { describe, expect, it } from "vitest";
import { expiryStatus } from "./expiryStatus";

const TODAY = "2026-11-16";
const a = (startDate: string | null, endDate: string) => ({ startDate, endDate });

describe("expiryStatus (the status cell in Expiry overview)", () => {
  it.each([
    [a("2025-01-01", "2026-11-26"), "expiring", "10 days left"],
    [a("2025-01-01", "2026-11-16"), "expiring", "Ends today"],
    [a("2025-01-01", "2026-11-15"), "expired", "Expired 1 day ago"],
    // Not started yet: the matrix shows "Starts later" (grey) and does not count it as expiring.
    [a("2026-11-20", "2026-12-10"), "upcoming", "Starts 20.11.2026"],
  ] as const)("%j → %s, %s", (assignment, status, text) => {
    expect(expiryStatus(assignment, TODAY)).toEqual({ status, text });
  });
});
