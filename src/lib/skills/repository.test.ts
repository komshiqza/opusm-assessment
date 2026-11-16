/**
 * Proves the write guard before any real write: FSM is replaced by a fake `fetch`, and we check
 * that no write request leaves the app when the target is not ours, and that own writes go out
 * in the right order.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OwnershipError } from "@/lib/fsm/guard";
import { FSM_TIMEOUT_MS, FsmTimeoutError } from "@/lib/fsm/client";
import {
  createAssignment,
  createAssignmentWithCertificates,
  createSkillDefinition,
  checkAssignmentCreated,
  recheckUploads,
  retryItems,
  uploadCertificates,
  loadCertificateFile,
  deleteAssignment,
  deleteCertificate,
  deleteSkillDefinition,
  DeleteImpactChangedError,
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
/** Attachment uploads with these file names fail in the fake FSM. */
let failingUploads: Set<string>;
/** Attachment uploads with these file names never get an answer from the fake FSM. */
let hangingUploads: Set<string>;
/** Attachments FSM has on our skill (the fake's own store, used by the timeout checks). */
let fsmAttachments: { id: string; fileName: string; description?: string }[];
/** A hanging upload is still stored by the fake FSM (the write arrived, only the answer is lost). */
let hangingUploadsArrive: boolean;
/** CoreSQL queries fail (e.g. the check after a timeout cannot reach FSM). */
let queriesFail: boolean;
/** Skill Service writes to this path never get an answer from the fake FSM (e.g. "skill/v2/skills"). */
let hangingWrite: string | null = null;
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
  failingUploads = new Set();
  hangingUploads = new Set();
  hangingWrite = null;
  fsmAttachments = [];
  hangingUploadsArrive = false;
  queriesFail = false;
  bulkAnswer = () => null;
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, "http://localhost");
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname.replace("/api/fsm/", "");
    calls.push({ method, path, body });

    if (path.startsWith("data/v4/Attachment/") && method === "DELETE") deletedAttachments.add(path.split("/")[3]);
    if (path === "query/v1" && queriesFail) return json({ error: "simulated outage" }, 503);
    if (path === "query/v1") {
      const rows = queryAnswer(body.query).filter((r) => !deletedAttachments.has((r as { a?: { id: string } }).a?.id ?? ""));
      return json({ data: rows, lastPage: 1 });
    }
    if (path.endsWith("/search")) return json({ content: searchAnswer(path, body.filter ?? []), last: true, totalElements: 0 });
    if (path.endsWith("/content") && method === "GET") {
      return attachmentAnswer
        ? new Response("%PDF-1.4 dummy", { status: 200, headers: { "content-type": "application/pdf;charset=ISO-8859-1" } })
        : json({ error: "CA-20", message: "CA-20: Object Attachment with id CCCC… not found" }, 404);
    }
    if (path.startsWith("data/v4/Attachment/") && method === "GET") {
      return attachmentAnswer ? json({ data: [{ attachment: attachmentAnswer }] }) : json({ error: "not found" }, 404);
    }
    if (path === "skill/v1/scales" && method === "POST") return json("EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE");
    if (path === hangingWrite) {
      return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    }
    if (path.startsWith("skill/v2/")) {
      return json(bulkAnswer(path, method, body) ?? { hasErrors: false, results: [{ status: 200, resource: { id: SKILL, ...body?.[0] } }] }, 207);
    }
    if (path.startsWith("data/v4/Attachment") && method === "POST") {
      if (failingUploads.has(body.fileName)) return json({ error: "CA-999", message: "CA-999: simulated upload failure" }, 500);
      if (hangingUploads.has(body.fileName)) {
        if (hangingUploadsArrive) fsmAttachments.push({ id: `LATE${fsmAttachments.length}`, fileName: body.fileName, description: body.description });
        return new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
      }
      fsmAttachments.push({ id: `${ATTACHMENT.slice(0, 28)}${String(fsmAttachments.length).padStart(4, "0")}`, fileName: body.fileName, description: body.description });
      return json({ data: [{ attachment: { id: ATTACHMENT, fileName: body.fileName, type: body.type, object: { objectId: SKILL, objectType: "SKILL" } } }] });
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
/** What the user confirmed in the delete dialog when the skill was not in use. */
const NOTHING_CONFIRMED = { skillIds: [], certificateIds: [] };

describe("guard refuses writes to data that is not ours (and sends nothing)", () => {
  it.each(["Gasnetz-Anschluss", "jdoe::Welding"])("delete skill definition %j", async (name) => {
    searchAnswer = tagNamed(name);
    await expect(deleteSkillDefinition(DEMO_TAG, NOTHING_CONFIRMED)).rejects.toThrow(OwnershipError);
    expect(writes()).toEqual([]);
  });

  it("create a skill whose name exists in FSM meanwhile (the list in the dialog may be out of date)", async () => {
    searchAnswer = (path) => (path === "skill/v1/tags/search" ? [{ id: OWN_TAG, name: "komshiqza::Welding" }] : []);
    await expect(createSkillDefinition("welding", "")).rejects.toThrow(/already exists/);
    expect(writes()).toEqual([]);
  });

  it("rename a skill to the name of another skill created meanwhile", async () => {
    const OTHER = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
    searchAnswer = (path, filter) => {
      if (path !== "skill/v1/tags/search") return [];
      const own = { id: OWN_TAG, name: "komshiqza::First aid" };
      if (filter.some((f) => f.field === "id")) return [own];
      return [own, { id: OTHER, name: "komshiqza::Welding" }];
    };
    await expect(updateSkillDefinition(OWN_TAG, "Welding", "")).rejects.toThrow(/already exists/);
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
  it("does not send a level that was not touched, so FSM keeps the stored one", async () => {
    searchAnswer = skillOfTag("komshiqza::Welding");
    await updateAssignment(SKILL, { startDate: "2026-01-01", endDate: "2027-01-01", proficiencyId: undefined });
    const [patch] = writes();
    expect(patch.method).toBe("PATCH");
    expect(patch.body).not.toHaveProperty("proficiencyId");
  });

  it("sends null to clear the level when the user picked 'No level' (measured: FSM then stores no level)", async () => {
    searchAnswer = skillOfTag("komshiqza::Welding");
    await updateAssignment(SKILL, { startDate: "2026-01-01", endDate: "2027-01-01", proficiencyId: null });
    expect(writes()[0].body).toMatchObject({ proficiencyId: null });
  });

  it("sends the level the user picked", async () => {
    searchAnswer = skillOfTag("komshiqza::Welding");
    await updateAssignment(SKILL, { startDate: "2026-01-01", endDate: null, proficiencyId: "LEVEL" });
    expect(writes()[0].body).toMatchObject({ proficiencyId: "LEVEL" });
  });

  it("deletes a skill definition in the order certificates → assignments → tag", async () => {
    queryAnswer = (sql) =>
      sql.includes("FROM Attachment a WHERE") ? [{ a: { id: ATTACHMENT, fileName: "a.pdf", type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } }] : [];
    searchAnswer = (path) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      if (path === "skill/v1/skills/search") return [{ id: SKILL, tagId: OWN_TAG, tagName: "komshiqza::Welding" }];
      return [];
    };

    await expect(deleteSkillDefinition(OWN_TAG, { skillIds: [SKILL], certificateIds: [ATTACHMENT] })).resolves.toEqual({ assignments: 1, certificates: 1 });
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      `DELETE data/v4/Attachment/${ATTACHMENT}`,
      "DELETE skill/v2/skills",
      "DELETE skill/v2/tags",
    ]);
  });

  it("deletes nothing and reports the new numbers when FSM has more than the user confirmed", async () => {
    const SECOND = "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
    searchAnswer = (path) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      // Someone assigned the skill once more after the dialog counted 1 assignment.
      if (path === "skill/v1/skills/search") return [SKILL, SECOND].map((id) => ({ id, tagId: OWN_TAG, tagName: "komshiqza::Welding" }));
      return [];
    };
    queryAnswer = (sql) =>
      sql.includes("FROM Attachment a WHERE") ? [{ a: { id: ATTACHMENT, fileName: "a.pdf", type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } }] : [];

    const attempt = deleteSkillDefinition(OWN_TAG, { skillIds: [SKILL], certificateIds: [ATTACHMENT] });
    await expect(attempt).rejects.toBeInstanceOf(DeleteImpactChangedError);
    await expect(attempt).rejects.toMatchObject({ impact: { assignments: 2, certificates: 1 } });
    expect(writes()).toEqual([]);
  });

  it("also stops when a certificate was added after the user confirmed", async () => {
    searchAnswer = (path) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      if (path === "skill/v1/skills/search") return [{ id: SKILL, tagId: OWN_TAG, tagName: "komshiqza::Welding" }];
      return [];
    };
    queryAnswer = (sql) =>
      sql.includes("FROM Attachment a WHERE") ? [{ a: { id: ATTACHMENT, fileName: "a.pdf", type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } }] : [];

    await expect(deleteSkillDefinition(OWN_TAG, { skillIds: [SKILL], certificateIds: [] })).rejects.toBeInstanceOf(DeleteImpactChangedError);
    expect(writes()).toEqual([]);
  });

  it("goes ahead when FSM has the same or less than the user confirmed", async () => {
    searchAnswer = (path) => (path === "skill/v1/tags/search" ? [{ id: OWN_TAG, name: "komshiqza::Welding" }] : []);
    // The one confirmed assignment was removed meanwhile: only the tag is left to delete.
    await expect(deleteSkillDefinition(OWN_TAG, { skillIds: [SKILL], certificateIds: [ATTACHMENT] })).resolves.toEqual({ assignments: 0, certificates: 0 });
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual(["DELETE skill/v2/tags"]);
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

    await expect(deleteSkillDefinition(OWN_TAG, { skillIds: [SKILL], certificateIds: [ATTACHMENT] })).rejects.toThrow(/Simulated FSM failure.*1 certificate/);
    // the tag itself was not touched after the failure
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([`DELETE data/v4/Attachment/${ATTACHMENT}`, "DELETE skill/v2/skills"]);
  });

  it("counts assignments FSM did delete when a bulk delete fails only for some of them", async () => {
    const SECOND = "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
    searchAnswer = (path) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      if (path === "skill/v1/skills/search") return [SKILL, SECOND].map((id) => ({ id, tagId: OWN_TAG, tagName: "komshiqza::Welding" }));
      return [];
    };
    bulkAnswer = (path) =>
      path === "skill/v2/skills"
        ? { hasErrors: true, results: [{ status: 200, resource: { id: SKILL } }, { status: 500, error: { detail: "Second assignment failed" } }] }
        : null;

    await expect(deleteSkillDefinition(OWN_TAG, { skillIds: [SKILL, SECOND], certificateIds: [] })).rejects.toThrow(/Second assignment failed.*1 assignment\b/);
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

describe("certificate files", () => {
  const cert = { id: ATTACHMENT, skillId: SKILL, fileName: "a.png", type: "PNG", createdAt: null };

  it("returns the file with the content type of its certificate type", async () => {
    attachmentAnswer = { id: ATTACHMENT };
    const blob = await loadCertificateFile(cert);
    expect(blob.type).toBe("image/png");
    expect(await blob.text()).toBe("%PDF-1.4 dummy");
  });

  it("passes FSM's own error message on, not only the HTTP status", async () => {
    attachmentAnswer = null;
    await expect(loadCertificateFile(cert)).rejects.toThrow(/CA-20: Object Attachment with id .* not found/);
  });
});

describe("assign and upload certificates in one step", () => {
  const files = ["a.pdf", "b.pdf", "c.pdf"].map((name) => new File(["%PDF-1.4 dummy"], name, { type: "application/pdf" }));
  const input = { startDate: null, endDate: null, proficiencyId: null };

  beforeEach(() => {
    searchAnswer = (path, filter) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      // the duplicate check (tag + person) finds nothing; the ownership check by id finds the new skill
      if (path === "skill/v1/skills/search" && filter.some((f) => f.field === "id")) return [{ id: SKILL, tagId: OWN_TAG, tagName: "komshiqza::Welding" }];
      return [];
    };
  });

  const steps = () =>
    writes().map((c) => (c.path === "data/v4/Attachment" ? `upload ${(c.body as { fileName: string }).fileName}` : `${c.method} ${c.path}`));

  it("creates the assignment first, then uploads every file in order", async () => {
    const result = await createAssignmentWithCertificates(OWN_TAG, PERSON, input, files);
    expect(steps()).toEqual(["POST skill/v2/skills", "upload a.pdf", "upload b.pdf", "upload c.pdf"]);
    expect(result.assignment.id).toBe(SKILL);
    expect(result.uploaded.map((c) => c.fileName)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(result.failed).toEqual([]);
    expect(result.unconfirmed).toEqual([]);
  });

  it("keeps the assignment when the 2nd of 3 uploads fails, reports it, and a retry uploads it", async () => {
    failingUploads = new Set(["b.pdf"]);
    const result = await createAssignmentWithCertificates(OWN_TAG, PERSON, input, files);
    expect(result.assignment.id).toBe(SKILL);
    expect(result.uploaded.map((c) => c.fileName)).toEqual(["a.pdf", "c.pdf"]);
    expect(result.failed.map((f) => [f.file.name, f.error])).toEqual([["b.pdf", expect.stringContaining("CA-999: simulated upload failure")]]);

    failingUploads = new Set();
    calls = [];
    const retry = await uploadCertificates(result.assignment.id, result.failed.map((f) => f.file));
    expect(retry).toMatchObject({ failed: [] });
    expect(steps()).toEqual(["upload b.pdf"]);
  });

  it("lists an upload FSM did not answer as unknown, not as failed, so it is not retried blindly", async () => {
    vi.useFakeTimers();
    try {
      hangingUploads = new Set(["b.pdf"]);
      const pending = createAssignmentWithCertificates(OWN_TAG, PERSON, input, files);
      await vi.advanceTimersByTimeAsync(FSM_TIMEOUT_MS);
      const result = await pending;
      expect(result.uploaded.map((c) => c.fileName)).toEqual(["a.pdf", "c.pdf"]);
      // checked in FSM right away: the fake did not store b.pdf, so it is "not uploaded", with its upload id to recheck before a retry
      expect(result.failed.map((f) => f.file.name)).toEqual(["b.pdf"]);
      expect(result.failed[0].uploadId).toMatch(/^[0-9a-f]{32}$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uploads nothing and reports an unknown result when FSM does not answer the create", async () => {
    vi.useFakeTimers();
    try {
      hangingWrite = "skill/v2/skills";
      const pending = createAssignmentWithCertificates(OWN_TAG, PERSON, input, files).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(FSM_TIMEOUT_MS);
      const error = await pending;
      expect(error).toBeInstanceOf(FsmTimeoutError);
      expect((error as FsmTimeoutError).write).toBe(true);
      // The dialog keeps the picked files: no upload was sent, so none can be lost or doubled.
      expect(steps()).toEqual(["POST skill/v2/skills"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uploads nothing when creating the assignment fails", async () => {
    bulkAnswer = (path, method) =>
      path === "skill/v2/skills" && method === "POST" ? { hasErrors: true, results: [{ status: 400, error: { detail: "Simulated create failure" } }] } : null;
    await expect(createAssignmentWithCertificates(OWN_TAG, PERSON, input, files)).rejects.toThrow(/Simulated create failure/);
    expect(steps()).toEqual(["POST skill/v2/skills"]);
  });
});

describe("a write FSM did not answer is checked once in FSM, never repeated automatically", () => {
  const file = (name: string, content = "%PDF-1.4 dummy") => new File([content], name, { type: "application/pdf" });
  const [a, b] = [file("a.pdf"), file("b.pdf")];
  const uploads = () => writes().filter((c) => c.path === "data/v4/Attachment").map((c) => (c.body as { fileName: string }).fileName);

  beforeEach(() => {
    vi.useFakeTimers();
    searchAnswer = (path, filter) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      if (path === "skill/v1/skills/search" && filter.some((f) => f.field === "id")) return [{ id: SKILL, tagId: OWN_TAG, tagName: "komshiqza::Welding" }];
      return [];
    };
    // Like FSM: attachments of the skill, filtered by the upload's id in the description when the query asks for it.
    queryAnswer = (sql) => {
      if (!sql.includes("FROM Attachment a WHERE")) return [];
      const wanted = /a\.description = '([^']*)'/.exec(sql)?.[1];
      return fsmAttachments
        .filter((x) => wanted === undefined || x.description === wanted)
        .map((x) => ({ a: { id: x.id, fileName: x.fileName, type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } }));
    };
  });
  afterEach(() => vi.useRealTimers());

  /** Runs an upload batch through the 60 s timeout of the hanging file. */
  async function uploadWithTimeout(items: Parameters<typeof uploadCertificates>[1]) {
    const pending = uploadCertificates(SKILL, items);
    await vi.advanceTimersByTimeAsync(FSM_TIMEOUT_MS);
    return pending;
  }

  it("every upload carries its own id, so the check finds exactly this upload", async () => {
    await uploadCertificates(SKILL, [a, b]);
    const descriptions = writes().map((c) => (c.body as { description?: string }).description);
    expect(descriptions.every((d) => /^Skill Management upload [0-9a-f]{32}$/.test(d ?? ""))).toBe(true);
    expect(new Set(descriptions).size).toBe(2);
  });

  it("upload: FSM has the file after the timeout → uploaded, and it is not sent again", async () => {
    hangingUploads = new Set(["b.pdf"]);
    hangingUploadsArrive = true;
    const outcome = await uploadWithTimeout([a, b]);
    expect(outcome.confirmedLate.map((f) => f.name)).toEqual(["b.pdf"]);
    expect(outcome.uploaded.map((c) => c.fileName)).toEqual(["a.pdf", "b.pdf"]);
    expect(outcome.failed).toEqual([]);
    expect(outcome.unconfirmed).toEqual([]);
    expect(uploads()).toEqual(["a.pdf", "b.pdf"]);
  });

  it("upload: FSM does not have the file → not uploaded; only the user's retry sends it again", async () => {
    hangingUploads = new Set(["b.pdf"]);
    const outcome = await uploadWithTimeout([a, b]);
    expect(outcome.failed.map((f) => f.file.name)).toEqual(["b.pdf"]);
    expect(outcome.failed[0].error).toMatch(/Not uploaded/);
    expect(outcome.failed[0].uploadId).toMatch(/^[0-9a-f]{32}$/);
    expect(uploads()).toEqual(["a.pdf", "b.pdf"]); // nothing repeated by itself

    hangingUploads = new Set();
    const retry = await uploadCertificates(SKILL, retryItems(outcome.failed));
    expect(retry.uploaded.map((c) => c.fileName)).toEqual(["b.pdf"]);
    expect(uploads()).toEqual(["a.pdf", "b.pdf", "b.pdf"]);
  });

  it("upload: the retry sees a file that arrived late and does not upload it twice", async () => {
    hangingUploads = new Set(["b.pdf"]);
    const outcome = await uploadWithTimeout([b]);
    const lost = writes()[0].body as { fileName: string; description: string };
    fsmAttachments.push({ id: "LATEARRIVAL", fileName: lost.fileName, description: lost.description }); // FSM finished it after all

    hangingUploads = new Set();
    const retry = await uploadCertificates(SKILL, retryItems(outcome.failed));
    expect(retry.confirmedLate.map((f) => f.name)).toEqual(["b.pdf"]);
    expect(uploads()).toEqual(["b.pdf"]); // only the original attempt
  });

  it("upload: another file with the same name is never taken for the lost one (Codex finding)", async () => {
    const first = file("scan.pdf", "%PDF-1.4 first");
    const second = file("scan.pdf", "%PDF-1.4 second");
    hangingUploads = new Set(["scan.pdf"]);
    const pending = uploadCertificates(SKILL, [first]);
    await vi.advanceTimersByTimeAsync(FSM_TIMEOUT_MS);
    const outcome = await pending; // the first scan.pdf did not arrive
    hangingUploads = new Set();
    await uploadCertificates(SKILL, [second]); // a different scan.pdf arrives

    const retry = await uploadCertificates(SKILL, retryItems(outcome.failed));
    expect(retry.confirmedLate).toEqual([]); // not falsely "uploaded"
    expect(retry.uploaded).toHaveLength(1); // the first scan.pdf is sent now
    expect(uploads()).toEqual(["scan.pdf", "scan.pdf", "scan.pdf"]);
  });

  it("upload: the check fails → not confirmed; 'Check again' decides without uploading", async () => {
    hangingUploads = new Set(["b.pdf"]);
    queriesFail = true; // FSM cannot be reached for the check after the timeout
    const outcome = await uploadWithTimeout([b]);
    expect(outcome.unconfirmed.map((f) => f.file.name)).toEqual(["b.pdf"]);
    expect(outcome.failed).toEqual([]);

    queriesFail = false;
    const again = await recheckUploads(SKILL, outcome.unconfirmed);
    expect(again.failed.map((f) => f.file.name)).toEqual(["b.pdf"]);
    expect(again.unconfirmed).toEqual([]);
    expect(uploads()).toEqual(["b.pdf"]); // still only the original attempt
  });

  it("a failing query does not stop uploads, so a just-created assignment is never lost (Codex finding)", async () => {
    queriesFail = true;
    searchAnswer = (path, filter) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      if (path === "skill/v1/skills/search" && filter.some((f) => f.field === "id")) return [{ id: SKILL, tagId: OWN_TAG, tagName: "komshiqza::Welding" }];
      return [];
    };
    const result = await createAssignmentWithCertificates(OWN_TAG, PERSON, { startDate: null, endDate: null }, [a]);
    expect(result.assignment.id).toBe(SKILL);
    expect(result.uploaded.map((c) => c.fileName)).toEqual(["a.pdf"]);
  });

  describe("create", () => {
    let created: boolean;
    let searchFails: boolean;
    beforeEach(() => {
      created = false;
      searchFails = false;
      const base = searchAnswer;
      searchAnswer = (path, filter) => {
        if (path === "skill/v1/skills/search" && filter.some((f) => f.field === "technicianId")) {
          if (searchFails) throw new Error("simulated outage");
          return created ? [{ id: SKILL, tagId: OWN_TAG, tagName: "komshiqza::Welding", technicianId: PERSON }] : [];
        }
        return base(path, filter);
      };
    });

    it("FSM has the assignment after the timeout → assigned, and it is not created again", async () => {
      hangingWrite = "skill/v2/skills";
      const attempt = createAssignmentWithCertificates(OWN_TAG, PERSON, { startDate: null, endDate: null }, []).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(FSM_TIMEOUT_MS);
      expect(await attempt).toBeInstanceOf(FsmTimeoutError);
      created = true; // the create arrived, only the answer was lost
      await expect(checkAssignmentCreated(OWN_TAG, PERSON)).resolves.toMatchObject({ result: "done", value: { id: SKILL } });
      expect(writes().filter((c) => c.path === "skill/v2/skills")).toHaveLength(1);
    });

    it("FSM does not have it → not assigned (the user may try again)", async () => {
      await expect(checkAssignmentCreated(OWN_TAG, PERSON)).resolves.toEqual({ result: "notDone" });
      expect(writes()).toEqual([]);
    });

    it("the check fails → not confirmed", async () => {
      searchFails = true;
      await expect(checkAssignmentCreated(OWN_TAG, PERSON)).resolves.toMatchObject({ result: "unconfirmed" });
      expect(writes()).toEqual([]);
    });
  });
});
