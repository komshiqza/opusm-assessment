import { describe, expect, it } from "vitest";
import { EMPTY_RESULTS, applyOutcome } from "./uploadResults";

const file = (name: string) => new File(["x"], name);
const [a, b, c] = [file("a.pdf"), file("b.pdf"), file("c.pdf")];
const outcome = (parts: Partial<Parameters<typeof applyOutcome>[1]>) => ({ uploaded: [], confirmedLate: [], failed: [], unconfirmed: [], ...parts });

describe("applyOutcome (what the dialog shows after uploads, retries and checks)", () => {
  it("shows the result of a first upload", () => {
    const state = applyOutcome(EMPTY_RESULTS, outcome({ confirmedLate: [a], failed: [{ file: b, error: "x", uploadId: "U1" }], unconfirmed: [{ file: c, error: "y", uploadId: "U2" }] }), null);
    expect(state.confirmedLate).toEqual(["a.pdf"]);
    expect(state.failed.map((f) => f.file)).toEqual([b]);
    expect(state.unconfirmed.map((f) => f.file)).toEqual([c]);
  });

  it("a retry replaces the 'not uploaded' list and keeps the files still waiting for a check", () => {
    const before = applyOutcome(EMPTY_RESULTS, outcome({ failed: [{ file: b, error: "x" }], unconfirmed: [{ file: c, error: "y", uploadId: "U2" }] }), null);
    const after = applyOutcome(before, outcome({ confirmedLate: [b] }), "failed");
    expect(after.failed).toEqual([]);
    expect(after.unconfirmed.map((f) => f.file)).toEqual([c]);
    expect(after.confirmedLate).toEqual(["b.pdf"]);
  });

  it("'Check again' replaces the 'not confirmed' list and adds what it found", () => {
    const before = applyOutcome(EMPTY_RESULTS, outcome({ unconfirmed: [{ file: c, error: "y", uploadId: "U2" }] }), null);
    const after = applyOutcome(before, outcome({ failed: [{ file: c, error: "not uploaded", uploadId: "U1" }] }), "unconfirmed");
    expect(after.unconfirmed).toEqual([]);
    expect(after.failed.map((f) => f.file)).toEqual([c]);
  });
});
