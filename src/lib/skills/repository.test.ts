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
/** Attachments deleted through the fake, so later queries no longer return them (like real FSM). */
let deletedAttachments: Set<string>;
/** Fake FSM: answers a query by looking at the SQL; everything else via `writeAnswers`. */
let queryAnswer: (sql: string) => unknown[];
let searchAnswer: (path: string, filter: { field: string; value: unknown }[]) => unknown[];
let attachmentAnswer: unknown = null;
/** Answer of bulk (v2) writes; default: every item succeeded. */
let bulkAnswer: ((path: string, method: string, body: unknown) => { hasErrors: boolean; results: unknown[] } | null) = () => null;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  calls = [];
  deletedAttachments = new Set();
  queryAnswer = () => [];
  searchAnswer = () => [];
  attachmentAnswer = null;
  bulkAnswer = () => null;
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, "http://localhost");
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname.replace("/api/fsm/", "");
    calls.push({ method, path, body });

    if (path.startsWith("data/v4/Attachment/") && method === "DELETE") deletedAttachments.add(path.split("/")[3]);
    if (path === "query/v1") {
      const rows = queryAnswer(body.query).filter((r) => !deletedAttachments.has((r as { a?: { id: string } }).a?.id ?? ""));
      return json({ data: rows, lastPage: 1 });
    }
    if (path.endsWith("/search")) return json({ content: searchAnswer(path, body.filter ?? []), last: true, totalElements: 0 });
    if (path.startsWith("data/v4/Attachment/") && method === "GET") {
      return attachmentAnswer ? json({ data: [{ attachment: attachmentAnswer }] }) : json({ error: "not found" }, 404);
    }
    if (path === "skill/v1/scales" && method === "POST") return json("EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE");
    if (path.startsWith("skill/v2/")) {
      return json(bulkAnswer(path, method, body) ?? { hasErrors: false, results: [{ status: 200, resource: { id: SKILL, ...body?.[0] } }] }, 207);
    }
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

/** Skill Service answers for the ownership lookups (tag by id, skill by id). */
const tagNamed = (name: string) => (path: string) => (path === "skill/v1/tags/search" ? [{ id: DEMO_TAG, name }] : []);
const skillOfTag = (name: string) => (path: string) =>
  path === "skill/v1/skills/search" ? [{ id: SKILL, tagId: OWN_TAG, tagName: name, technicianId: PERSON }] : [];
const pdf = () => new File(["%PDF-1.4 dummy"], "cert.pdf", { type: "application/pdf" });

describe("guard refuses writes to data that is not ours (and sends nothing)", () => {
  it.each(["Gasnetz-Anschluss", "jdoe::Welding"])("delete skill definition %j", async (name) => {
    searchAnswer = tagNamed(name);
    await expect(deleteSkillDefinition(DEMO_TAG)).rejects.toThrow(OwnershipError);
    expect(writes()).toEqual([]);
  });

  it("rename a demo tag", async () => {
    searchAnswer = tagNamed("Hydraulik");
    await expect(updateSkillDefinition(DEMO_TAG, "Hydraulik 2", "")).rejects.toThrow(OwnershipError);
    expect(writes()).toEqual([]);
  });

  it("assign a demo tag to a person", async () => {
    searchAnswer = tagNamed("Hydraulik");
    await expect(createAssignment(DEMO_TAG, PERSON, { startDate: null, endDate: null, proficiencyId: null })).rejects.toThrow(OwnershipError);
    expect(writes()).toEqual([]);
  });

  it("edit or remove a skill of a demo tag", async () => {
    searchAnswer = skillOfTag("Hydraulik");
    await expect(updateAssignment(SKILL, { startDate: null, endDate: "2027-01-01", proficiencyId: null })).rejects.toThrow(OwnershipError);
    await expect(deleteAssignment(SKILL)).rejects.toThrow(OwnershipError);
    expect(writes()).toEqual([]);
  });

  it("upload a certificate to a skill of another candidate", async () => {
    searchAnswer = skillOfTag("jdoe::Welding");
    await expect(uploadCertificate(SKILL, pdf())).rejects.toThrow(OwnershipError);
    expect(writes()).toEqual([]);
  });

  it("delete an attachment that is not on one of our skills", async () => {
    attachmentAnswer = null; // not found
    await expect(deleteCertificate(ATTACHMENT)).rejects.toThrow(OwnershipError);
    attachmentAnswer = { id: ATTACHMENT, object: { objectId: PERSON, objectType: "PERSON" } }; // not on a skill
    await expect(deleteCertificate(ATTACHMENT)).rejects.toThrow(OwnershipError);
    attachmentAnswer = { id: ATTACHMENT, object: { objectId: SKILL, objectType: "SKILL" } };
    searchAnswer = skillOfTag("Hydraulik"); // on a skill of a demo tag
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
    queryAnswer = (sql) =>
      sql.includes("FROM Attachment a WHERE") ? [{ a: { id: ATTACHMENT, fileName: "a.pdf", type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } }] : [];
    searchAnswer = (path) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      if (path === "skill/v1/skills/search") return [{ id: SKILL, tagId: OWN_TAG, tagName: "komshiqza::Welding" }];
      return [];
    };

    await expect(deleteSkillDefinition(OWN_TAG)).resolves.toEqual({ assignments: 1, certificates: 1 });
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      `DELETE data/v4/Attachment/${ATTACHMENT}`,
      "DELETE skill/v2/skills",
      "DELETE skill/v2/tags",
    ]);
  });

  it("removing an assignment also deletes a certificate that was uploaded while the removal ran", async () => {
    searchAnswer = skillOfTag("komshiqza::Welding");
    let skillDeleted = false;
    const LATE = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
    bulkAnswer = (path, method) => {
      if (path === "skill/v2/skills" && method === "DELETE") skillDeleted = true;
      return null;
    };
    // Before the skill is deleted FSM lists one certificate; afterwards a second one shows up (late upload).
    queryAnswer = (sql) => {
      if (!sql.includes("FROM Attachment a WHERE")) return [];
      const cert = (id: string) => ({ a: { id, fileName: `${id}.pdf`, type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } });
      return skillDeleted ? [cert(LATE)] : [cert(ATTACHMENT)];
    };

    await deleteAssignment(SKILL);
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      `DELETE data/v4/Attachment/${ATTACHMENT}`,
      "DELETE skill/v2/skills",
      `DELETE data/v4/Attachment/${LATE}`,
    ]);
  });

  it("reports what was already deleted when a cascade fails half-way", async () => {
    searchAnswer = (path) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      if (path === "skill/v1/skills/search") return [{ id: SKILL, tagId: OWN_TAG, tagName: "komshiqza::Welding" }];
      return [];
    };
    queryAnswer = (sql) =>
      sql.includes("FROM Attachment a WHERE") ? [{ a: { id: ATTACHMENT, fileName: "a.pdf", type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } }] : [];
    bulkAnswer = (path) =>
      path === "skill/v2/skills" ? { hasErrors: true, results: [{ status: 500, error: { detail: "Simulated FSM failure" } }] } : null;

    await expect(deleteSkillDefinition(OWN_TAG)).rejects.toThrow(/Simulated FSM failure.*1 certificate/);
    // the tag itself was not touched after the failure
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([`DELETE data/v4/Attachment/${ATTACHMENT}`, "DELETE skill/v2/skills"]);
  });

  it("deletes an own certificate with exactly one request", async () => {
    attachmentAnswer = { id: ATTACHMENT, object: { objectId: SKILL, objectType: "SKILL" } };
    searchAnswer = skillOfTag("komshiqza::Welding");
    await deleteCertificate(ATTACHMENT);
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([`DELETE data/v4/Attachment/${ATTACHMENT}`]);
  });

  it("uploads a certificate to an own skill", async () => {
    searchAnswer = skillOfTag("komshiqza::Welding");
    await uploadCertificate(SKILL, pdf());
    const [upload] = writes();
    expect(upload).toMatchObject({ method: "POST", path: "data/v4/Attachment", body: { type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } });
  });

  it("rejects invalid dates before asking FSM anything", async () => {
    await expect(createAssignment(OWN_TAG, PERSON, { startDate: "2027-01-02", endDate: "2027-01-01", proficiencyId: null })).rejects.toThrow(/before/);
    expect(calls).toEqual([]);
  });
});
