/**
 * Proves the write guard before any real write: FSM is replaced by a fake `fetch`, and we check
 * that no write request leaves the app when the target is not ours, and that own writes go out
 * in the right order.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnershipError } from "@/lib/fsm/guard";
import {
  createAssignment,
  deleteAssignment,
  deleteCertificate,
  deleteSkillDefinition,
  updateAssignment,
  updateSkillDefinition,
  uploadCertificate,
} from "./repository";

// Node has no FileReader; the base64 encoding itself is not under test here.
vi.mock("@/lib/fsm/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fsm/client")>()),
  fileToBase64: async () => "JVBERi0xLjQgZHVtbXk=",
}));

const DEMO_TAG = "C99F18163E7E42D4ACEB8349FDB313B7"; // "Gasnetz-Anschluss" in the demo company
const OWN_TAG = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SKILL = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const ATTACHMENT = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
const PERSON = "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";

interface Call {
  method: string;
  path: string;
  body: unknown;
}

let calls: Call[];
/** Fake FSM: answers a query by looking at the SQL; everything else via `writeAnswers`. */
let queryAnswer: (sql: string) => unknown[];
let searchAnswer: (path: string) => unknown[];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  calls = [];
  queryAnswer = () => [];
  searchAnswer = () => [];
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, "http://localhost");
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname.replace("/api/fsm/", "");
    calls.push({ method, path, body });

    if (path === "query/v1") return json({ data: queryAnswer(body.query), lastPage: 1 });
    if (path.endsWith("/search")) return json({ content: searchAnswer(path), last: true, totalElements: 0 });
    if (path === "skill/v1/scales" && method === "POST") return json("EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE");
    if (path.startsWith("skill/v2/")) return json({ hasErrors: false, results: [{ status: 200, resource: { id: SKILL, ...body?.[0] } }] }, 207);
    if (path.startsWith("data/v4/Attachment") && method === "POST") {
      return json({ data: [{ attachment: { id: ATTACHMENT, fileName: "a.pdf", type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } }] });
    }
    return json({});
  });
});

afterEach(() => vi.unstubAllGlobals());

/** Requests that change data (searches and CoreSQL queries are reads). */
function writes() {
  return calls.filter((c) => c.method !== "GET" && c.path !== "query/v1" && !c.path.endsWith("/search"));
}

const tagNamed = (name: string) => (sql: string) => (sql.includes("FROM Tag t WHERE") ? [{ t: { id: DEMO_TAG, name } }] : []);
const skillOfTag = (name: string) => (sql: string) =>
  sql.includes("FROM Skill s JOIN Tag") ? [{ s: { id: SKILL, tag: OWN_TAG }, t: { name } }] : [];
const pdf = () => new File(["%PDF-1.4 dummy"], "cert.pdf", { type: "application/pdf" });

describe("guard refuses writes to data that is not ours (and sends nothing)", () => {
  it.each(["Gasnetz-Anschluss", "jdoe::Welding"])("delete skill definition %j", async (name) => {
    queryAnswer = tagNamed(name);
    await expect(deleteSkillDefinition(DEMO_TAG)).rejects.toThrow(OwnershipError);
    expect(writes()).toEqual([]);
  });

  it("rename a demo tag", async () => {
    queryAnswer = tagNamed("Hydraulik");
    await expect(updateSkillDefinition(DEMO_TAG, "Hydraulik 2", "")).rejects.toThrow(OwnershipError);
    expect(writes()).toEqual([]);
  });

  it("assign a demo tag to a person", async () => {
    queryAnswer = tagNamed("Hydraulik");
    await expect(createAssignment(DEMO_TAG, PERSON, { startDate: null, endDate: null, proficiencyId: null })).rejects.toThrow(OwnershipError);
    expect(writes()).toEqual([]);
  });

  it("edit or remove a skill of a demo tag", async () => {
    queryAnswer = skillOfTag("Hydraulik");
    await expect(updateAssignment(SKILL, { startDate: null, endDate: "2027-01-01", proficiencyId: null })).rejects.toThrow(OwnershipError);
    await expect(deleteAssignment(SKILL)).rejects.toThrow(OwnershipError);
    expect(writes()).toEqual([]);
  });

  it("upload a certificate to a skill of another candidate", async () => {
    queryAnswer = skillOfTag("jdoe::Welding");
    await expect(uploadCertificate(SKILL, pdf())).rejects.toThrow(OwnershipError);
    expect(writes()).toEqual([]);
  });

  it("delete an attachment that is not on one of our skills", async () => {
    queryAnswer = () => []; // join finds nothing: not a SKILL attachment, or not found
    await expect(deleteCertificate(ATTACHMENT)).rejects.toThrow(OwnershipError);
    queryAnswer = (sql) => (sql.includes("FROM Attachment a JOIN") ? [{ t: { name: "Hydraulik" } }] : []);
    await expect(deleteCertificate(ATTACHMENT)).rejects.toThrow(OwnershipError);
    expect(writes()).toEqual([]);
  });

  it("ids that could change the CoreSQL query", async () => {
    await expect(deleteCertificate("x' OR '1'='1")).rejects.toThrow(OwnershipError);
    expect(calls).toEqual([]);
  });
});

describe("own data", () => {
  it("deletes a skill definition in the order certificates → assignments → tag", async () => {
    queryAnswer = (sql) => {
      if (sql.includes("FROM Tag t WHERE")) return [{ t: { id: OWN_TAG, name: "komshiqza::Welding" } }];
      if (sql.includes("FROM Attachment a WHERE")) return [{ a: { id: ATTACHMENT, fileName: "a.pdf", type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } }];
      return [];
    };
    searchAnswer = (path) => (path === "skill/v1/skills/search" ? [{ id: SKILL, tagId: OWN_TAG, tagName: "komshiqza::Welding" }] : []);

    await expect(deleteSkillDefinition(OWN_TAG)).resolves.toEqual({ assignments: 1, certificates: 1 });
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      `DELETE data/v4/Attachment/${ATTACHMENT}`,
      "DELETE skill/v2/skills",
      "DELETE skill/v2/tags",
    ]);
  });

  it("uploads a certificate to an own skill", async () => {
    queryAnswer = skillOfTag("komshiqza::Welding");
    await uploadCertificate(SKILL, pdf());
    const [upload] = writes();
    expect(upload).toMatchObject({ method: "POST", path: "data/v4/Attachment", body: { type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } });
  });

  it("rejects invalid dates before asking FSM anything", async () => {
    await expect(createAssignment(OWN_TAG, PERSON, { startDate: "2027-01-02", endDate: "2027-01-01", proficiencyId: null })).rejects.toThrow(/before/);
    expect(calls).toEqual([]);
  });
});
