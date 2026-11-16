import { describe, expect, it } from "vitest";
import { MAX_CERTIFICATE_BYTES, effectiveStartDate, validateCertificateFile, validateSkillName, validateValidity } from "./validation";

describe("validateValidity", () => {
  it.each([
    [null, null],
    ["2026-01-01", null],
    [null, "2026-01-01"],
    ["2026-01-01", "2026-01-01"],
    ["2026-01-01", "2027-01-01"],
  ])("accepts from=%s to=%s", (from, to) => {
    expect(validateValidity(from, to)).toBeNull();
  });

  it("rejects 'valid to' before 'valid from'", () => {
    expect(validateValidity("2026-05-02", "2026-05-01")).toMatch(/before/);
  });

  it("rejects malformed and impossible dates", () => {
    expect(validateValidity("01.05.2026", null)).toMatch(/date/);
    expect(validateValidity(null, "2026-02-30")).toMatch(/date/);
  });

  it("rejects the Skill Service 'open end' marker as a real date", () => {
    expect(validateValidity(null, "9999-12-31")).toMatch(/9999/);
  });
});

describe("validateSkillName", () => {
  it("accepts a normal name", () => {
    expect(validateSkillName("Hydraulics", [])).toBeNull();
  });
  it("rejects empty, too long, '::' and duplicates (case-insensitive)", () => {
    expect(validateSkillName("   ", [])).toMatch(/enter/i);
    expect(validateSkillName("x".repeat(101), [])).toMatch(/100/);
    expect(validateSkillName("a::b", [])).toMatch(/::/);
    expect(validateSkillName("hydraulics", ["Hydraulics"])).toMatch(/exists/);
  });
});

describe("validateCertificateFile", () => {
  const file = (name: string, size: number, type = "") => ({ name, size, type });

  it.each([
    ["cert.pdf", "PDF"],
    ["photo.JPG", "JPEG"],
    ["photo.jpeg", "JPEG"],
    ["scan.png", "PNG"],
  ])("accepts %s as %s", (name, type) => {
    expect(validateCertificateFile(file(name, 1000))).toEqual({ ok: true, type });
  });

  it("rejects other types", () => {
    expect(validateCertificateFile(file("cert.docx", 1000))).toMatchObject({ ok: false });
    expect(validateCertificateFile(file("noextension", 1000))).toMatchObject({ ok: false });
  });

  it("allows the brief's 5 MB (5,242,880 bytes) and refuses anything larger", () => {
    expect(MAX_CERTIFICATE_BYTES).toBe(5 * 1024 * 1024);
    expect(validateCertificateFile(file("a.pdf", 2 * 1024 * 1024))).toMatchObject({ ok: true });
    expect(validateCertificateFile(file("a.pdf", 5 * 1024 * 1024 + 1))).toMatchObject({ ok: false, error: expect.stringMatching(/larger than 5 MB/) });
  });

  it("checks the limit on the original file size, inclusive", () => {
    expect(validateCertificateFile(file("a.pdf", MAX_CERTIFICATE_BYTES))).toMatchObject({ ok: true });
    expect(validateCertificateFile(file("a.pdf", MAX_CERTIFICATE_BYTES + 1))).toMatchObject({ ok: false });
  });

  it("rejects empty files", () => {
    expect(validateCertificateFile(file("a.pdf", 0))).toMatchObject({ ok: false });
  });
});

describe("effectiveStartDate", () => {
  it("uses today when 'valid from' is empty (FSM requires a start date)", () => {
    expect(effectiveStartDate(null, "2026-11-16")).toBe("2026-11-16");
    expect(effectiveStartDate("2025-01-01", "2026-11-16")).toBe("2025-01-01");
  });
});
