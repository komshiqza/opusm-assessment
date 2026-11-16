import { describe, expect, it } from "vitest";
import { csvCell, csvFileName, matrixCsv } from "./matrixCsv";

const TODAY = "2026-11-16";
const persons = [
  { id: "sarah", name: "Sarah Müller", jobTitle: "Service Technician" },
  { id: "evil", name: "=HYPERLINK(\"http://x\")", jobTitle: "Lead; \"North\"" },
];
const skills = [
  { id: "AID", name: "First aid" },
  { id: "WELD", name: "Welding (steel)" },
];
const assignment = (endDate: string | null, level: string | null) => ({
  id: `S-${endDate}`,
  tagId: "X",
  personId: "p",
  startDate: "2025-02-01",
  endDate,
  proficiencyId: null,
  proficiencyName: level,
  proficiencyLevel: null,
});
const held: Record<string, ReturnType<typeof assignment>> = { "sarah|AID": assignment("2026-12-15", "Advanced") };
const lookup = (p: string, t: string) => held[`${p}|${t}`];
const certCount = () => 1;
const noType = () => "";

describe("csvCell (Excel-safe cells)", () => {
  it("quotes cells with separator, quotes or line breaks and doubles inner quotes", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });

  it("stops formulas: a cell starting with = + - @ (also full-width ＝ ＋ － ＠) gets a leading apostrophe", () => {
    for (const start of ["=", "+", "-", "@", "＠", "＝", "＋", "－"]) expect(csvCell(`${start}1+2`)).toBe(`'${start}1+2`);
    expect(csvCell("=A;1")).toBe(`"'=A;1"`);
  });

  it("keeps umlauts as they are", () => {
    expect(csvCell("Müller")).toBe("Müller");
  });
});

describe("matrixCsv (exactly the visible matrix)", () => {
  const csv = matrixCsv([persons[0]], noType, [skills[0]], lookup, certCount, TODAY);
  const [header, row] = csv.replace(/^﻿/, "").split("\r\n");

  it("starts with a BOM, so Excel reads UTF-8 (Müller stays Müller)", () => {
    expect(csv.startsWith("﻿")).toBe(true);
    expect(row.startsWith("Sarah Müller;")).toBe(true);
  });

  it("has Person, Record, Job title and five columns per visible skill, separated by semicolons", () => {
    expect(header).toBe(
      "Person;Record;Job title;First aid – Status;First aid – Valid from;First aid – Valid to;First aid – Level;First aid – Certificates",
    );
    expect(row).toBe("Sarah Müller;;Service Technician;Expiring soon;01.02.2025;15.12.2026;Advanced;1");
  });

  it("contains only the rows and skill columns it is given (the current filters)", () => {
    const all = matrixCsv(persons, noType, skills, lookup, certCount, TODAY).split("\r\n");
    expect(all).toHaveLength(3);
    expect(csv.split("\r\n")).toHaveLength(2);
    expect(header).not.toContain("Welding");
  });

  it("guards and quotes names and job titles from FSM", () => {
    const evil = matrixCsv([persons[1]], noType, [skills[1]], lookup, certCount, TODAY).split("\r\n")[1];
    expect(evil).toBe(`"'=HYPERLINK(""http://x"")";;"Lead; ""North""";Not assigned;;;;`);
  });

  it("tells two records of one person apart by the record type the screen shows", () => {
    const twins = [
      { id: "erp", name: "Anna Schneider", jobTitle: "Service Technician", type: "ERPUSER" },
      { id: "emp", name: "Anna Schneider", jobTitle: "Service Technician", type: "EMPLOYEE" },
    ];
    const typeOf = (p: (typeof twins)[number]) => (p.type === "ERPUSER" ? "ERP user" : "Employee");
    const [, erp, emp] = matrixCsv(twins, typeOf, [skills[0]], lookup, certCount, TODAY).split("\r\n");
    expect(erp).toBe("Anna Schneider;ERP user;Service Technician;Not assigned;;;;");
    expect(emp).toBe("Anna Schneider;Employee;Service Technician;Not assigned;;;;");
  });

  it("names the file after the day", () => {
    expect(csvFileName(TODAY)).toBe("skill-matrix-2026-11-16.csv");
  });
});
