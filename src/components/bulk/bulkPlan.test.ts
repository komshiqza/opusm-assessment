import { describe, expect, it } from "vitest";
import { mergeResults, planBulk } from "./bulkPlan";

describe("planBulk (preview before assigning)", () => {
  it("assigns the selected persons who do not have the skill and skips the others", () => {
    const plan = planBulk(["a", "b", "c"], (id) => id === "b");
    expect(plan).toEqual({ toAssign: ["a", "c"], skip: ["b"], overLimit: false });
  });

  it("flags more than 25 persons to assign", () => {
    const ids = Array.from({ length: 26 }, (_, i) => `p${i}`);
    expect(planBulk(ids, () => false).overLimit).toBe(true);
    expect(planBulk(ids.slice(0, 25), () => false).overLimit).toBe(false);
  });

  it("counts only persons to assign against the limit (skipped ones need no write)", () => {
    const ids = Array.from({ length: 30 }, (_, i) => `p${i}`);
    expect(planBulk(ids, (id) => Number(id.slice(1)) >= 25).overLimit).toBe(false);
  });
});

describe("mergeResults (a retry replaces the lines of the retried persons)", () => {
  it("keeps the other lines in their order", () => {
    const first = [
      { personId: "a", result: "assigned" as const },
      { personId: "b", result: "failed" as const, error: "x" },
      { personId: "c", result: "unconfirmed" as const, error: "y" },
    ];
    const merged = mergeResults(first, [{ personId: "b", result: "assigned" }]);
    expect(merged.map((r) => [r.personId, r.result])).toEqual([
      ["a", "assigned"],
      ["b", "assigned"],
      ["c", "unconfirmed"],
    ]);
  });
});
