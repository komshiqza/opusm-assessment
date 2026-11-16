/**
 * Proves the write guard before any real write: FSM is replaced by a fake `fetch` (fakeFsm.ts), and we check
 * that no write request leaves the app when the target is not ours, and that own writes go out in the right order.
 */
import { describe, expect, it, vi } from "vitest";
import { OwnershipError } from "@/lib/fsm/guard";
import { createAssignment, createSkillDefinition, deleteAssignment, deleteSkillDefinition, DeleteImpactChangedError, updateAssignment, updateSkillDefinition } from "./repository";
import { deleteCertificate, uploadCertificate } from "./certificates";
import { installFakeFsm, fsm, writes, tagNamed, skillOfTag, pdf, NOTHING_CONFIRMED, DEMO_TAG, OWN_TAG, SKILL, ATTACHMENT, PERSON } from "./fakeFsm";

// Node has no FileReader; the base64 encoding itself is not under test here.
vi.mock("@/lib/fsm/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fsm/client")>()),
  fileToBase64: async (file: Blob) => Buffer.from(await file.arrayBuffer()).toString("base64"),
}));

installFakeFsm();

describe("guard refuses writes to data that is not ours (and sends nothing)", () => {
  it.each(["Gasnetz-Anschluss", "jdoe::Welding"])("delete skill definition %j", async (name) => {
    fsm.searchAnswer = tagNamed(name);
    await expect(deleteSkillDefinition(DEMO_TAG, NOTHING_CONFIRMED)).rejects.toThrow(OwnershipError);
    expect(writes()).toEqual([]);
  });

  it("create a skill whose name exists in FSM meanwhile (the list in the dialog may be out of date)", async () => {
    fsm.searchAnswer = (path) => (path === "skill/v1/tags/search" ? [{ id: OWN_TAG, name: "komshiqza::Welding" }] : []);
    await expect(createSkillDefinition("welding", "")).rejects.toThrow(/already exists/);
    expect(writes()).toEqual([]);
  });

  it("rename a skill to the name of another skill created meanwhile", async () => {
    const OTHER = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
    fsm.searchAnswer = (path, filter) => {
      if (path !== "skill/v1/tags/search") return [];
      const own = { id: OWN_TAG, name: "komshiqza::First aid" };
      if (filter.some((f) => f.field === "id")) return [own];
      return [own, { id: OTHER, name: "komshiqza::Welding" }];
    };
    await expect(updateSkillDefinition(OWN_TAG, "Welding", "")).rejects.toThrow(/already exists/);
    expect(writes()).toEqual([]);
  });

  it("rename a demo tag", async () => {
    fsm.searchAnswer = tagNamed("Hydraulik");
    await expect(updateSkillDefinition(DEMO_TAG, "Hydraulik 2", "")).rejects.toThrow(OwnershipError);
    expect(writes()).toEqual([]);
  });

  it("assign a demo tag to a person", async () => {
    fsm.searchAnswer = tagNamed("Hydraulik");
    await expect(createAssignment(DEMO_TAG, PERSON, { startDate: null, endDate: null, proficiencyId: null })).rejects.toThrow(OwnershipError);
    expect(writes()).toEqual([]);
  });

  it("edit or remove a skill of a demo tag", async () => {
    fsm.searchAnswer = skillOfTag("Hydraulik");
    await expect(updateAssignment(SKILL, { startDate: null, endDate: "2027-01-01", proficiencyId: null })).rejects.toThrow(OwnershipError);
    await expect(deleteAssignment(SKILL)).rejects.toThrow(OwnershipError);
    expect(writes()).toEqual([]);
  });

  it("upload a certificate to a skill of another candidate", async () => {
    fsm.searchAnswer = skillOfTag("jdoe::Welding");
    await expect(uploadCertificate(SKILL, pdf())).rejects.toThrow(OwnershipError);
    expect(writes()).toEqual([]);
  });

  it("delete an attachment that is not on one of our skills", async () => {
    fsm.attachmentAnswer = null; // not found
    await expect(deleteCertificate(ATTACHMENT)).rejects.toThrow(OwnershipError);
    fsm.attachmentAnswer = { id: ATTACHMENT, object: { objectId: PERSON, objectType: "PERSON" } }; // not on a skill
    await expect(deleteCertificate(ATTACHMENT)).rejects.toThrow(OwnershipError);
    fsm.attachmentAnswer = { id: ATTACHMENT, object: { objectId: SKILL, objectType: "SKILL" } };
    fsm.searchAnswer = skillOfTag("Hydraulik"); // on a skill of a demo tag
    await expect(deleteCertificate(ATTACHMENT)).rejects.toThrow(OwnershipError);
    expect(writes()).toEqual([]);
  });

  it("ids that could change the CoreSQL query", async () => {
    await expect(deleteCertificate("x' OR '1'='1")).rejects.toThrow(OwnershipError);
    expect(fsm.calls).toEqual([]);
  });
});

describe("own data", () => {
  it("does not send a level that was not touched, so FSM keeps the stored one", async () => {
    fsm.searchAnswer = skillOfTag("komshiqza::Welding");
    await updateAssignment(SKILL, { startDate: "2026-01-01", endDate: "2027-01-01", proficiencyId: undefined });
    const [patch] = writes();
    expect(patch.method).toBe("PATCH");
    expect(patch.body).not.toHaveProperty("proficiencyId");
  });

  it("sends null to clear the level when the user picked 'No level' (measured: FSM then stores no level)", async () => {
    fsm.searchAnswer = skillOfTag("komshiqza::Welding");
    await updateAssignment(SKILL, { startDate: "2026-01-01", endDate: "2027-01-01", proficiencyId: null });
    expect(writes()[0].body).toMatchObject({ proficiencyId: null });
  });

  it("sends the level the user picked", async () => {
    fsm.searchAnswer = skillOfTag("komshiqza::Welding");
    await updateAssignment(SKILL, { startDate: "2026-01-01", endDate: null, proficiencyId: "LEVEL" });
    expect(writes()[0].body).toMatchObject({ proficiencyId: "LEVEL" });
  });

  it("deletes a skill definition in the order certificates → assignments → tag", async () => {
    fsm.queryAnswer = (sql) =>
      sql.includes("FROM Attachment a WHERE") ? [{ a: { id: ATTACHMENT, fileName: "a.pdf", type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } }] : [];
    fsm.searchAnswer = (path) => {
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
    fsm.searchAnswer = (path) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      // Someone assigned the skill once more after the dialog counted 1 assignment.
      if (path === "skill/v1/skills/search") return [SKILL, SECOND].map((id) => ({ id, tagId: OWN_TAG, tagName: "komshiqza::Welding" }));
      return [];
    };
    fsm.queryAnswer = (sql) =>
      sql.includes("FROM Attachment a WHERE") ? [{ a: { id: ATTACHMENT, fileName: "a.pdf", type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } }] : [];

    const attempt = deleteSkillDefinition(OWN_TAG, { skillIds: [SKILL], certificateIds: [ATTACHMENT] });
    await expect(attempt).rejects.toBeInstanceOf(DeleteImpactChangedError);
    await expect(attempt).rejects.toMatchObject({ impact: { assignments: 2, certificates: 1 } });
    expect(writes()).toEqual([]);
  });

  it("also stops when a certificate was added after the user confirmed", async () => {
    fsm.searchAnswer = (path) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      if (path === "skill/v1/skills/search") return [{ id: SKILL, tagId: OWN_TAG, tagName: "komshiqza::Welding" }];
      return [];
    };
    fsm.queryAnswer = (sql) =>
      sql.includes("FROM Attachment a WHERE") ? [{ a: { id: ATTACHMENT, fileName: "a.pdf", type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } }] : [];

    await expect(deleteSkillDefinition(OWN_TAG, { skillIds: [SKILL], certificateIds: [] })).rejects.toBeInstanceOf(DeleteImpactChangedError);
    expect(writes()).toEqual([]);
  });

  it("goes ahead when FSM has the same or less than the user confirmed", async () => {
    fsm.searchAnswer = (path) => (path === "skill/v1/tags/search" ? [{ id: OWN_TAG, name: "komshiqza::Welding" }] : []);
    // The one confirmed assignment was removed meanwhile: only the tag is left to delete.
    await expect(deleteSkillDefinition(OWN_TAG, { skillIds: [SKILL], certificateIds: [ATTACHMENT] })).resolves.toEqual({ assignments: 0, certificates: 0 });
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual(["DELETE skill/v2/tags"]);
  });

  /**
   * A certificate uploaded (e.g. in another tab) after the first listing: FSM shows it from the second
   * listing on. It must be deleted while its assignment still exists, because the server refuses to
   * delete an attachment whose skill is gone ("not yours"), which would leave it orphaned.
   */
  const LATE = "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE";
  const lateUpload = () => {
    let listings = 0;
    const cert = (id: string) => ({ a: { id, fileName: `${id}.pdf`, type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } });
    fsm.queryAnswer = (sql) => {
      if (!sql.includes("FROM Attachment a WHERE")) return [];
      listings++;
      return listings === 1 ? [cert(ATTACHMENT)] : [cert(ATTACHMENT), cert(LATE)];
    };
  };

  it("removing an assignment deletes a late certificate before the assignment itself", async () => {
    fsm.searchAnswer = skillOfTag("komshiqza::Welding");
    lateUpload();

    await deleteAssignment(SKILL);
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      `DELETE data/v4/Attachment/${ATTACHMENT}`,
      `DELETE data/v4/Attachment/${LATE}`,
      "DELETE skill/v2/skills",
    ]);
  });

  it("deleting a skill deletes a late certificate before the assignments and the tag", async () => {
    fsm.searchAnswer = (path) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      if (path === "skill/v1/skills/search") return [{ id: SKILL, tagId: OWN_TAG, tagName: "komshiqza::Welding" }];
      return [];
    };
    lateUpload();

    await expect(deleteSkillDefinition(OWN_TAG, { skillIds: [SKILL], certificateIds: [ATTACHMENT] })).resolves.toEqual({ assignments: 1, certificates: 2 });
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      `DELETE data/v4/Attachment/${ATTACHMENT}`,
      `DELETE data/v4/Attachment/${LATE}`,
      "DELETE skill/v2/skills",
      "DELETE skill/v2/tags",
    ]);
  });

  it.each(["an assignment", "a skill"])("removing %s reports a certificate that arrived after the last look (it cannot be deleted any more)", async (what) => {
    fsm.searchAnswer = (path) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      if (path === "skill/v1/skills/search") return [{ id: SKILL, tagId: OWN_TAG, tagName: "komshiqza::Welding", technicianId: PERSON }];
      return [];
    };
    let skillDeleted = false;
    fsm.bulkAnswer = (path, method) => {
      if (path === "skill/v2/skills" && method === "DELETE") skillDeleted = true;
      return null;
    };
    const cert = (id: string) => ({ a: { id, fileName: `${id}.pdf`, type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } });
    // The upload finishes between the last look and the delete: FSM lists it only afterwards.
    fsm.queryAnswer = (sql) => (sql.includes("FROM Attachment a WHERE") && skillDeleted ? [cert(LATE)] : []);

    const removal = what === "an assignment" ? deleteAssignment(SKILL) : deleteSkillDefinition(OWN_TAG, { skillIds: [SKILL], certificateIds: [] });
    await expect(removal).rejects.toThrow(/1 certificate was uploaded while this was being removed/);
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual(["DELETE skill/v2/skills"]); // the tag is not deleted after this
  });

  it("also reports a certificate left behind when the assignments were deleted only in part", async () => {
    const SECOND = "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
    fsm.searchAnswer = (path) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      if (path === "skill/v1/skills/search") return [SKILL, SECOND].map((id) => ({ id, tagId: OWN_TAG, tagName: "komshiqza::Welding" }));
      return [];
    };
    let deleteSent = false;
    fsm.bulkAnswer = (path, method) => {
      if (path !== "skill/v2/skills" || method !== "DELETE") return null;
      deleteSent = true;
      return { hasErrors: true, results: [{ status: 200, resource: { id: SKILL } }, { status: 500, error: { detail: "Second assignment failed" } }] };
    };
    const cert = (id: string) => ({ a: { id, fileName: `${id}.pdf`, type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } });
    fsm.queryAnswer = (sql) => (sql.includes("FROM Attachment a WHERE") && deleteSent ? [cert(LATE)] : []);

    const removal = deleteSkillDefinition(OWN_TAG, { skillIds: [SKILL, SECOND], certificateIds: [] });
    await expect(removal).rejects.toThrow(/Second assignment failed.*1 certificate was uploaded while this was being removed/);
  });

  it("does not call a late certificate on an assignment that was not deleted 'left behind' (it can still be deleted)", async () => {
    const SECOND = "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
    fsm.searchAnswer = (path) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      if (path === "skill/v1/skills/search") return [SKILL, SECOND].map((id) => ({ id, tagId: OWN_TAG, tagName: "komshiqza::Welding" }));
      return [];
    };
    let deleteSent = false;
    fsm.bulkAnswer = (path, method) => {
      if (path !== "skill/v2/skills" || method !== "DELETE") return null;
      deleteSent = true;
      return { hasErrors: true, results: [{ status: 200, resource: { id: SKILL } }, { status: 500, error: { detail: "Second assignment failed" } }] };
    };
    const onSecond = { a: { id: LATE, fileName: "late.pdf", type: "PDF", object: { objectId: SECOND, objectType: "SKILL" } } };
    fsm.queryAnswer = (sql) => (sql.includes("FROM Attachment a WHERE") && deleteSent && sql.includes(SECOND) ? [onSecond] : []);

    const removal = deleteSkillDefinition(OWN_TAG, { skillIds: [SKILL, SECOND], certificateIds: [] });
    await expect(removal).rejects.toThrow(/Second assignment failed/);
    await expect(removal).rejects.not.toThrow(/uploaded while this was being removed/);
  });

  it("reports what was already deleted when a cascade fails half-way", async () => {
    fsm.searchAnswer = (path) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      if (path === "skill/v1/skills/search") return [{ id: SKILL, tagId: OWN_TAG, tagName: "komshiqza::Welding" }];
      return [];
    };
    fsm.queryAnswer = (sql) =>
      sql.includes("FROM Attachment a WHERE") ? [{ a: { id: ATTACHMENT, fileName: "a.pdf", type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } }] : [];
    fsm.bulkAnswer = (path) =>
      path === "skill/v2/skills" ? { hasErrors: true, results: [{ status: 500, error: { detail: "Simulated FSM failure" } }] } : null;

    await expect(deleteSkillDefinition(OWN_TAG, { skillIds: [SKILL], certificateIds: [ATTACHMENT] })).rejects.toThrow(/Simulated FSM failure.*1 certificate/);
    // the tag itself was not touched after the failure
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([`DELETE data/v4/Attachment/${ATTACHMENT}`, "DELETE skill/v2/skills"]);
  });

  it("counts assignments FSM did delete when a bulk delete fails only for some of them", async () => {
    const SECOND = "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF";
    fsm.searchAnswer = (path) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      if (path === "skill/v1/skills/search") return [SKILL, SECOND].map((id) => ({ id, tagId: OWN_TAG, tagName: "komshiqza::Welding" }));
      return [];
    };
    fsm.bulkAnswer = (path) =>
      path === "skill/v2/skills"
        ? { hasErrors: true, results: [{ status: 200, resource: { id: SKILL } }, { status: 500, error: { detail: "Second assignment failed" } }] }
        : null;

    await expect(deleteSkillDefinition(OWN_TAG, { skillIds: [SKILL, SECOND], certificateIds: [] })).rejects.toThrow(/Second assignment failed.*1 assignment\b/);
  });

  it("deletes an own certificate with exactly one request", async () => {
    fsm.attachmentAnswer = { id: ATTACHMENT, object: { objectId: SKILL, objectType: "SKILL" } };
    fsm.searchAnswer = skillOfTag("komshiqza::Welding");
    await deleteCertificate(ATTACHMENT);
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([`DELETE data/v4/Attachment/${ATTACHMENT}`]);
  });

  it("uploads a certificate to an own skill", async () => {
    fsm.searchAnswer = skillOfTag("komshiqza::Welding");
    await uploadCertificate(SKILL, pdf());
    const [upload] = writes();
    expect(upload).toMatchObject({ method: "POST", path: "data/v4/Attachment", body: { type: "PDF", object: { objectId: SKILL, objectType: "SKILL" } } });
  });

  it("rejects invalid dates before asking FSM anything", async () => {
    await expect(createAssignment(OWN_TAG, PERSON, { startDate: "2027-01-02", endDate: "2027-01-01", proficiencyId: null })).rejects.toThrow(/before/);
    expect(fsm.calls).toEqual([]);
  });
});
