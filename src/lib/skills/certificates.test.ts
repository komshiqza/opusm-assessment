/**
 * Certificates against a fake FSM: upload order, failed and retried uploads, and the check after an upload
 * or a create FSM did not answer (never sent again by itself).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FSM_TIMEOUT_MS, FsmTimeoutError } from "@/lib/fsm/client";
import { checkAssignmentCreated } from "./repository";
import { createAssignmentWithCertificates, recheckUploads, retryItems, uploadCertificates, loadCertificateFile } from "./certificates";
import { installFakeFsm, fsm, writes, OWN_TAG, SKILL, ATTACHMENT, PERSON } from "./fakeFsm";

// Node has no FileReader; the base64 encoding itself is not under test here.
vi.mock("@/lib/fsm/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fsm/client")>()),
  fileToBase64: async (file: Blob) => Buffer.from(await file.arrayBuffer()).toString("base64"),
}));

installFakeFsm();

describe("certificate files", () => {
  const cert = { id: ATTACHMENT, skillId: SKILL, fileName: "a.png", type: "PNG", createdAt: null };

  it("returns the file with the content type of its certificate type", async () => {
    fsm.attachmentAnswer = { id: ATTACHMENT };
    const blob = await loadCertificateFile(cert);
    expect(blob.type).toBe("image/png");
    expect(await blob.text()).toBe("%PDF-1.4 dummy");
  });

  it("passes FSM's own error message on, not only the HTTP status", async () => {
    fsm.attachmentAnswer = null;
    await expect(loadCertificateFile(cert)).rejects.toThrow(/CA-20: Object Attachment with id .* not found/);
  });
});

describe("assign and upload certificates in one step", () => {
  const files = ["a.pdf", "b.pdf", "c.pdf"].map((name) => new File(["%PDF-1.4 dummy"], name, { type: "application/pdf" }));
  const input = { startDate: null, endDate: null, proficiencyId: null };

  beforeEach(() => {
    fsm.searchAnswer = (path, filter) => {
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
    fsm.failingUploads = new Set(["b.pdf"]);
    const result = await createAssignmentWithCertificates(OWN_TAG, PERSON, input, files);
    expect(result.assignment.id).toBe(SKILL);
    expect(result.uploaded.map((c) => c.fileName)).toEqual(["a.pdf", "c.pdf"]);
    expect(result.failed.map((f) => [f.file.name, f.error])).toEqual([["b.pdf", expect.stringContaining("CA-999: simulated upload failure")]]);

    fsm.failingUploads = new Set();
    fsm.calls = [];
    const retry = await uploadCertificates(result.assignment.id, result.failed.map((f) => f.file));
    expect(retry).toMatchObject({ failed: [] });
    expect(steps()).toEqual(["upload b.pdf"]);
  });

  it("lists an upload FSM did not answer as unknown, not as failed, so it is not retried blindly", async () => {
    vi.useFakeTimers();
    try {
      fsm.hangingUploads = new Set(["b.pdf"]);
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
      fsm.hangingWrite = "skill/v2/skills";
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
    fsm.bulkAnswer = (path, method) =>
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
    fsm.searchAnswer = (path, filter) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      if (path === "skill/v1/skills/search" && filter.some((f) => f.field === "id")) return [{ id: SKILL, tagId: OWN_TAG, tagName: "komshiqza::Welding" }];
      return [];
    };
    // Like FSM: attachments of the skill, filtered by the upload's id in the description when the query asks for it.
    fsm.queryAnswer = (sql) => {
      if (!sql.includes("FROM Attachment a WHERE")) return [];
      const wanted = /a\.description = '([^']*)'/.exec(sql)?.[1];
      return fsm.fsmAttachments
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
    fsm.hangingUploads = new Set(["b.pdf"]);
    fsm.hangingUploadsArrive = true;
    const outcome = await uploadWithTimeout([a, b]);
    expect(outcome.confirmedLate.map((f) => f.name)).toEqual(["b.pdf"]);
    expect(outcome.uploaded.map((c) => c.fileName)).toEqual(["a.pdf", "b.pdf"]);
    expect(outcome.failed).toEqual([]);
    expect(outcome.unconfirmed).toEqual([]);
    expect(uploads()).toEqual(["a.pdf", "b.pdf"]);
  });

  it("upload: the proxy answers 502 after FSM stored the file → checked and uploaded, never sent again", async () => {
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
      const response = await base(input, init); // the fake FSM stores the file
      const body = init.body ? JSON.parse(String(init.body)) : {};
      if (String(input).includes("data/v4/Attachment") && init.method === "POST" && body.fileName === "b.pdf") {
        return new Response(JSON.stringify({ error: "socket hang up", code: "UPSTREAM" }), { status: 502 });
      }
      return response;
    });
    const outcome = await uploadCertificates(SKILL, [a, b]);
    expect(outcome.confirmedLate.map((f) => f.name)).toEqual(["b.pdf"]);
    expect(outcome.failed).toEqual([]);
    expect(uploads()).toEqual(["a.pdf", "b.pdf"]);
  });

  it("upload: FSM does not have the file → not uploaded; only the user's retry sends it again", async () => {
    fsm.hangingUploads = new Set(["b.pdf"]);
    const outcome = await uploadWithTimeout([a, b]);
    expect(outcome.failed.map((f) => f.file.name)).toEqual(["b.pdf"]);
    expect(outcome.failed[0].error).toMatch(/not in FSM/);
    expect(outcome.failed[0].uploadId).toMatch(/^[0-9a-f]{32}$/);
    expect(uploads()).toEqual(["a.pdf", "b.pdf"]); // nothing repeated by itself

    fsm.hangingUploads = new Set();
    const retry = await uploadCertificates(SKILL, retryItems(outcome.failed));
    expect(retry.uploaded.map((c) => c.fileName)).toEqual(["b.pdf"]);
    expect(uploads()).toEqual(["a.pdf", "b.pdf", "b.pdf"]);
  });

  it("upload: the retry sees a file that arrived late and does not upload it twice", async () => {
    fsm.hangingUploads = new Set(["b.pdf"]);
    const outcome = await uploadWithTimeout([b]);
    const lost = writes()[0].body as { fileName: string; description: string };
    fsm.fsmAttachments.push({ id: "E".repeat(32), fileName: lost.fileName, description: lost.description, content: "%PDF-1.4 dummy" }); // FSM finished it after all

    fsm.hangingUploads = new Set();
    const retry = await uploadCertificates(SKILL, retryItems(outcome.failed));
    expect(retry.confirmedLate.map((f) => f.name)).toEqual(["b.pdf"]);
    expect(uploads()).toEqual(["b.pdf"]); // only the original attempt
  });

  it("upload: an identical file that was already there before is not taken for this upload", async () => {
    // Same name and same bytes, uploaded earlier on purpose: it carries no id of this upload.
    fsm.fsmAttachments.push({ id: "D".repeat(32), fileName: "b.pdf", description: "", content: "%PDF-1.4 dummy" });
    fsm.hangingUploads = new Set(["b.pdf"]); // this upload does not arrive
    const outcome = await uploadWithTimeout([b]);
    expect(outcome.confirmedLate).toEqual([]);
    expect(outcome.failed.map((f) => f.file.name)).toEqual(["b.pdf"]);
  });

  it("upload: the new attachment of this upload with the same bytes → uploaded", async () => {
    fsm.hangingUploads = new Set(["b.pdf"]);
    fsm.hangingUploadsArrive = true;
    const outcome = await uploadWithTimeout([b]);
    expect(outcome.confirmedLate.map((f) => f.name)).toEqual(["b.pdf"]);
    // the content was downloaded and compared
    expect(fsm.calls.some((c) => c.method === "GET" && c.path.endsWith("/content"))).toBe(true);
  });

  it("upload: the new attachment of this upload has different bytes → not confirmed, never a guess", async () => {
    fsm.hangingUploads = new Set(["b.pdf"]);
    const pending = uploadCertificates(SKILL, [b]);
    await vi.advanceTimersByTimeAsync(1);
    const sent = writes()[0].body as { fileName: string; description: string };
    fsm.fsmAttachments.push({ id: "F".repeat(32), fileName: sent.fileName, description: sent.description, content: "%PDF-1.4 other!" });
    await vi.advanceTimersByTimeAsync(FSM_TIMEOUT_MS);
    const outcome = await pending;
    expect(outcome.unconfirmed.map((f) => f.file.name)).toEqual(["b.pdf"]);
    expect(outcome.unconfirmed[0].error).toMatch(/content/i);
    expect(outcome.confirmedLate).toEqual([]);
    expect(outcome.failed).toEqual([]);
  });

  it("upload: the content of the new attachment cannot be downloaded → not confirmed", async () => {
    fsm.hangingUploads = new Set(["b.pdf"]);
    fsm.hangingUploadsArrive = true;
    fsm.contentFails = true;
    const outcome = await uploadWithTimeout([b]);
    expect(outcome.unconfirmed.map((f) => f.file.name)).toEqual(["b.pdf"]);
    expect(outcome.confirmedLate).toEqual([]);
  });

  it("upload: another file with the same name is never taken for the lost one (Codex finding)", async () => {
    const first = file("scan.pdf", "%PDF-1.4 first");
    const second = file("scan.pdf", "%PDF-1.4 second");
    fsm.hangingUploads = new Set(["scan.pdf"]);
    const pending = uploadCertificates(SKILL, [first]);
    await vi.advanceTimersByTimeAsync(FSM_TIMEOUT_MS);
    const outcome = await pending; // the first scan.pdf did not arrive
    fsm.hangingUploads = new Set();
    await uploadCertificates(SKILL, [second]); // a different scan.pdf arrives

    const retry = await uploadCertificates(SKILL, retryItems(outcome.failed));
    expect(retry.confirmedLate).toEqual([]); // not falsely "uploaded"
    expect(retry.uploaded).toHaveLength(1); // the first scan.pdf is sent now
    expect(uploads()).toEqual(["scan.pdf", "scan.pdf", "scan.pdf"]);
  });

  it("upload: the check fails → not confirmed; 'Check again' decides without uploading", async () => {
    fsm.hangingUploads = new Set(["b.pdf"]);
    fsm.queriesFail = true; // FSM cannot be reached for the check after the timeout
    const outcome = await uploadWithTimeout([b]);
    expect(outcome.unconfirmed.map((f) => f.file.name)).toEqual(["b.pdf"]);
    expect(outcome.failed).toEqual([]);

    fsm.queriesFail = false;
    const again = await recheckUploads(SKILL, outcome.unconfirmed);
    expect(again.failed.map((f) => f.file.name)).toEqual(["b.pdf"]);
    expect(again.unconfirmed).toEqual([]);
    expect(uploads()).toEqual(["b.pdf"]); // still only the original attempt
  });

  it("a failing query does not stop uploads, so a just-created assignment is never lost (Codex finding)", async () => {
    fsm.queriesFail = true;
    fsm.searchAnswer = (path, filter) => {
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
      const base = fsm.searchAnswer;
      fsm.searchAnswer = (path, filter) => {
        if (path === "skill/v1/skills/search" && filter.some((f) => f.field === "technicianId")) {
          if (searchFails) throw new Error("simulated outage");
          return created ? [{ id: SKILL, tagId: OWN_TAG, tagName: "komshiqza::Welding", technicianId: PERSON }] : [];
        }
        return base(path, filter);
      };
    });

    it("FSM has the assignment after the timeout → assigned, and it is not created again", async () => {
      fsm.hangingWrite = "skill/v2/skills";
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
