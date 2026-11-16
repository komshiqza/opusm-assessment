import { describe, expect, it } from "vitest";
import { EMPTY_RESULTS, applyOutcome, createResultLine, resultLines } from "./uploadResults";

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

  it("a retry replaces the line of the retried file and keeps the others", () => {
    const before = applyOutcome(EMPTY_RESULTS, outcome({ failed: [{ file: b, error: "x" }], unconfirmed: [{ file: c, error: "y", uploadId: "U2" }] }), null);
    const after = applyOutcome(before, outcome({ confirmedLate: [b] }), [b]);
    expect(after.failed).toEqual([]);
    expect(after.unconfirmed.map((f) => f.file)).toEqual([c]);
    expect(after.confirmedLate).toEqual(["b.pdf"]);
  });

  it("'Check again' replaces the line of the checked file with what it found", () => {
    const before = applyOutcome(EMPTY_RESULTS, outcome({ unconfirmed: [{ file: c, error: "y", uploadId: "U2" }] }), null);
    const after = applyOutcome(before, outcome({ failed: [{ file: c, error: "not uploaded", uploadId: "U1" }] }), [c]);
    expect(after.unconfirmed).toEqual([]);
    expect(after.failed.map((f) => f.file)).toEqual([c]);
  });
});

describe("resultLines (one short line per file)", () => {
  it("found: '<file> uploaded.' with no button", () => {
    const lines = resultLines({ confirmedLate: ["a.pdf"], failed: [], unconfirmed: [] });
    expect(lines).toEqual([{ kind: "uploaded", text: "a.pdf uploaded.", file: null }]);
  });

  it("not found after a timeout: '<file> was not uploaded.' with the technical reason only as detail", () => {
    const [line] = resultLines({ confirmedLate: [], failed: [{ file: b, error: "FSM did not answer in time; the file is not in FSM.", uploadId: "U1" }], unconfirmed: [] });
    expect(line).toMatchObject({ kind: "notUploaded", text: "b.pdf was not uploaded.", detail: "FSM did not answer in time; the file is not in FSM.", file: b });
  });

  it("unknown: 'Couldn't confirm <file>.' without 'FSM error 503' in the text", () => {
    const [line] = resultLines({ confirmedLate: [], failed: [], unconfirmed: [{ file: c, error: "FSM error 503: simulated outage", uploadId: "U2" }] });
    expect(line).toMatchObject({ kind: "unconfirmed", text: "Couldn’t confirm c.pdf.", detail: "FSM error 503: simulated outage", file: c });
    expect(line.text).not.toMatch(/FSM|503/);
  });

  it("a file FSM refused (no timeout) keeps its short reason, so the user knows what to fix", () => {
    const [line] = resultLines({ confirmedLate: [], failed: [{ file: b, error: "FSM rejected the file: it is too large." }], unconfirmed: [] });
    expect(line.text).toBe("b.pdf was not uploaded: FSM rejected the file: it is too large.");
  });
});

describe("createResultLine (a new assignment FSM answered too late for)", () => {
  it("uses the short texts", () => {
    expect(createResultLine({ result: "done" })).toMatchObject({ kind: "uploaded", text: "Skill assigned." });
    expect(createResultLine({ result: "notDone" })).toMatchObject({ kind: "notUploaded", text: "The skill was not assigned." });
    expect(createResultLine({ result: "unconfirmed", error: "FSM error 503: x" })).toMatchObject({
      kind: "unconfirmed",
      text: "Couldn’t confirm the assignment.",
      detail: "FSM error 503: x",
    });
  });
});
