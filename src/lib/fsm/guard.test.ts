import { describe, expect, it } from "vitest";
import { OwnershipError, assertFsmId, assertOwnName, assertOwnedByTagName } from "./guard";

// NEXT_PUBLIC_CANDIDATE_ID is set to "komshiqza" in vitest.config.ts.

describe("assertOwnName", () => {
  it("allows names in the own namespace", () => {
    expect(() => assertOwnName("komshiqza::Hydraulics", "Tag")).not.toThrow();
  });

  it.each([
    "Hydraulik", // seeded demo tag
    "Gasnetz-Anschluss", // seeded demo tag
    "jdoe::Hydraulics", // another candidate
    "komshiqza:Hydraulics", // single colon
    "xkomshiqza::Hydraulics", // prefix only as a substring
    "KOMSHIQZA::Hydraulics", // FSM LIKE may be case-insensitive, the guard is not
    "komshiqza::", // empty display name
    "",
  ])("refuses %j", (name) => {
    expect(() => assertOwnName(name, "Tag")).toThrow(OwnershipError);
  });
});

describe("assertFsmId", () => {
  it("accepts a 32-character FSM id", () => {
    expect(() => assertFsmId("C99F18163E7E42D4ACEB8349FDB313B7")).not.toThrow();
  });
  it.each(["", "abc", "C99F18163E7E42D4ACEB8349FDB313B7' OR '1'='1", "../Tag"])("refuses %j", (id) => {
    expect(() => assertFsmId(id)).toThrow(OwnershipError);
  });
});

describe("assertOwnedByTagName", () => {
  it("allows a record whose tag is own", () => {
    expect(() => assertOwnedByTagName({ tagName: "komshiqza::Welding" }, "Skill")).not.toThrow();
  });
  it("refuses a record that was not found", () => {
    expect(() => assertOwnedByTagName(null, "Skill")).toThrow(OwnershipError);
  });
  it("refuses a record of a demo or foreign tag", () => {
    expect(() => assertOwnedByTagName({ tagName: "Hydraulik" }, "Skill")).toThrow(OwnershipError);
    expect(() => assertOwnedByTagName({ tagName: "jdoe::Welding" }, "Attachment")).toThrow(OwnershipError);
  });
});
