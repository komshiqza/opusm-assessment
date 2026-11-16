/**
 * The server-side ownership check, tested through the real proxy route handler.
 * FSM is replaced by a fake: it knows a demo tag, another candidate's tag and our own tag, and
 * records every request. Refused writes must answer 403 and never reach the fake FSM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/fsm/token", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fsm/token")>()),
  getFsmSession: async () => ({ token: "t", clusterUrl: "https://fsm.test", accountId: "1", companyId: "2", companyName: "Test", expiresAt: Date.now() + 3_600_000 }),
}));

import { DELETE, PATCH, POST } from "@/app/api/fsm/[...path]/route";

const id = (c: string) => c.repeat(32);
const DEMO_TAG = id("D"); // "Gasnetz-Anschluss", seeded demo data
const JDOE_TAG = id("E"); // "jdoe::Welding", another candidate
const OWN_TAG = id("A"); // "komshiqza::Welding"
const OWN_SCALE = id("5");
const OWN_LEVEL = id("B"); // "Basic" of our scale
const FOREIGN_LEVEL = id("6"); // a level of another scale
const DEMO_SKILL = id("1");
const JDOE_SKILL = id("2");
const OWN_SKILL = id("3");
const DEMO_ATTACHMENT = id("7");
const OWN_ATTACHMENT = id("8");
const PERSON = id("9");

interface Call {
  method: string;
  path: string;
}
/** A minimal valid PDF, base64 as the app sends it. */
const PDF_B64 = Buffer.from("%PDF-1.4\n% dummy\n").toString("base64");
const upload = (objectId: string, extra: Record<string, unknown> = {}) => ({
  fileName: "a.pdf",
  type: "PDF",
  fileContent: PDF_B64,
  object: { objectId, objectType: "SKILL" },
  ...extra,
});

let calls: Call[];
let failSearches: boolean;
/** Tag name FSM reports for OWN_SKILL (changed during a test to simulate another writer). */
let ownSkillTagName: string;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  calls = [];
  failSearches = false;
  ownSkillTagName = "komshiqza::Welding";
  vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ method, path: url.pathname });
    if (url.pathname.endsWith("/search")) {
      if (failSearches) return json({ message: "unavailable" }, 503);
      if (url.pathname.endsWith("/v1/tags/search")) {
        return json({ last: true, content: [{ id: DEMO_TAG, name: "Gasnetz-Anschluss" }, { id: JDOE_TAG, name: "jdoe::Welding" }, { id: OWN_TAG, name: "komshiqza::Welding" }] });
      }
      if (url.pathname.endsWith("/v1/skills/search")) {
        return json({
          last: true,
          content: [
            { id: DEMO_SKILL, tagId: DEMO_TAG, tagName: "Gasnetz-Anschluss" },
            { id: JDOE_SKILL, tagId: JDOE_TAG, tagName: "jdoe::Welding" },
            { id: OWN_SKILL, tagId: OWN_TAG, tagName: ownSkillTagName },
          ],
        });
      }
      if (url.pathname.endsWith("/v1/scales/search")) return json({ last: true, content: [{ id: OWN_SCALE, name: "komshiqza::Proficiency" }] });
      if (url.pathname.endsWith(`/v1/scales/${OWN_SCALE}/proficiencies/search`)) return json({ last: true, content: [{ id: OWN_LEVEL, name: "Basic" }] });
    }
    if (method === "GET" && url.pathname.startsWith("/api/data/v4/Attachment/")) {
      const objectId = { [DEMO_ATTACHMENT]: DEMO_SKILL, [OWN_ATTACHMENT]: OWN_SKILL }[url.pathname.split("/")[5]];
      return objectId ? json({ data: [{ attachment: { object: { objectType: "SKILL", objectId } } }] }) : json({ error: "CA-20" }, 404);
    }
    return json({ ok: true }); // a write that reached FSM
  });
});

afterEach(() => vi.unstubAllGlobals());

/** Requests that would change data in FSM (searches and GETs are reads). */
const writesReachingFsm = () => calls.filter((c) => c.method !== "GET" && !c.path.endsWith("/search"));

async function send(method: "POST" | "PATCH" | "DELETE", path: string, body?: unknown) {
  const handler = { POST, PATCH, DELETE }[method];
  const req = new Request(`http://localhost/api/fsm/${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const res = await handler(req, { params: Promise.resolve({ path: path.split("?")[0].split("/").map(decodeURIComponent) }) });
  return { status: res.status, body: (await res.json().catch(() => null)) as { code?: string; error?: string } | null };
}

describe("refused on the server: 403, and nothing reaches FSM", () => {
  it.each([
    ["rename the demo tag Gasnetz-Anschluss", "POST", "skill/v2/tags", [{ id: DEMO_TAG, name: "komshiqza::Taken" }]],
    ["create a tag without our prefix", "POST", "skill/v2/tags", [{ name: "Gasnetz-Anschluss" }]],
    ["link our tag to a scale that is not ours", "POST", "skill/v2/tags", [{ name: "komshiqza::Welding", scaleId: id("6") }]],
    ["delete jdoe::Welding", "DELETE", "skill/v2/tags", [{ id: JDOE_TAG }]],
    ["delete a demo skill", "DELETE", "skill/v2/skills", [{ id: DEMO_SKILL }]],
    ["assign jdoe::Welding to a person", "POST", "skill/v2/skills", [{ tagId: JDOE_TAG, technician: PERSON, startDate: "2026-01-01" }]],
    ["mix one own and one foreign item in a bulk delete", "DELETE", "skill/v2/skills", [{ id: OWN_SKILL }, { id: DEMO_SKILL }]],
    ["edit a demo skill", "PATCH", `skill/v1/tags/${DEMO_TAG}/skills/${DEMO_SKILL}`, { endDate: "2027-01-01" }],
    ["edit a demo skill through our tag's path", "PATCH", `skill/v1/tags/${OWN_TAG}/skills/${DEMO_SKILL}`, { endDate: "2027-01-01" }],
    ["upload a certificate to a demo skill", "POST", "data/v4/Attachment", upload(DEMO_SKILL)],
    ["upload a file to a person", "POST", "data/v4/Attachment", upload(PERSON, { object: { objectId: PERSON, objectType: "PERSON" } })],
    ["delete an attachment of a demo skill", "DELETE", `data/v4/Attachment/${DEMO_ATTACHMENT}`, undefined],
    ["delete an attachment that does not exist", "DELETE", `data/v4/Attachment/${id("4")}`, undefined],
    ["unknown write the proxy allows: PATCH a Tag through the Data API", "PATCH", `data/v4/Tag/${OWN_TAG}`, { name: "komshiqza::X" }],
    ["unknown write the proxy allows: DELETE a scale", "DELETE", "skill/v2/scales", { id: OWN_SCALE }],
    ["unknown write the proxy allows: POST proficiencies", "POST", `skill/v1/scales/${OWN_SCALE}/proficiencies`, [{ name: "x" }]],
    ["malformed id in the path", "DELETE", `data/v4/Attachment/${encodeURIComponent("x' OR '1'='1")}`, undefined],
    ["malformed id in the body", "DELETE", "skill/v2/skills", [{ id: "../tags" }]],
    ["a body that is not JSON", "POST", "skill/v2/tags", "not json"],
    ["an empty bulk write", "DELETE", "skill/v2/tags", []],
    // Only the fields the app itself sends may pass (an exact allowlist per write).
    ["create our scale with the id of a foreign scale", "POST", "skill/v1/scales", { id: id("6"), name: "komshiqza::Proficiency", proficiencies: [{ name: "Basic" }] }],
    ["create our scale with a foreign level id", "POST", "skill/v1/scales", { name: "komshiqza::Proficiency", proficiencies: [{ id: id("6"), name: "Basic" }] }],
    ["create our scale with a level of a foreign scale", "POST", "skill/v1/scales", { name: "komshiqza::Proficiency", proficiencies: [{ name: "Basic", scaleId: id("6") }] }],
    ["create our scale with levels that are not a list", "POST", "skill/v1/scales", { name: "komshiqza::Proficiency", proficiencies: { name: "Basic" } }],
    ["edit our skill with a nested foreign tag", "PATCH", `skill/v1/tags/${OWN_TAG}/skills/${OWN_SKILL}`, { endDate: "2027-01-01", tag: { id: DEMO_TAG } }],
    ["edit our skill and move it to another tag", "PATCH", `skill/v1/tags/${OWN_TAG}/skills/${OWN_SKILL}`, { tagId: OWN_TAG, endDate: "2027-01-01" }],
    ["edit our skill with a date that is not a date", "PATCH", `skill/v1/tags/${OWN_TAG}/skills/${OWN_SKILL}`, { endDate: { $gt: "" } }],
    ["assign our tag with a nested foreign tag", "POST", "skill/v2/skills", [{ tagId: OWN_TAG, tag: { id: DEMO_TAG }, technician: PERSON, startDate: "2026-01-01" }]],
    ["assign our tag with the id of a demo skill", "POST", "skill/v2/skills", [{ id: DEMO_SKILL, tagId: OWN_TAG, technician: PERSON, startDate: "2026-01-01" }]],
    ["assign our tag to a person given as an object", "POST", "skill/v2/skills", [{ tagId: OWN_TAG, technician: { id: PERSON }, startDate: "2026-01-01" }]],
    ["create our tag with an extra field", "POST", "skill/v2/tags", [{ name: "komshiqza::Crane", scaleId: OWN_SCALE, scale: { id: id("6") } }]],
    ["delete our tag with an extra field", "DELETE", "skill/v2/tags", [{ id: OWN_TAG, name: "x" }]],
    ["delete our skill with an extra field", "DELETE", "skill/v2/skills", [{ id: OWN_SKILL, tagId: DEMO_TAG }]],
    ["assign our tag with a level of another scale", "POST", "skill/v2/skills", [{ tagId: OWN_TAG, technician: PERSON, proficiencyId: FOREIGN_LEVEL, startDate: "2026-01-01" }]],
    ["edit our skill to a level of another scale", "PATCH", `skill/v1/tags/${OWN_TAG}/skills/${OWN_SKILL}`, { proficiencyId: FOREIGN_LEVEL, endDate: "2027-01-01" }],
  ] as const)("%s", async (_name, method, path, body) => {
    const res = await send(method, path, body);
    expect(res.status).toBe(403);
    expect(res.body?.code).toBe("NOT_OWN");
    expect(writesReachingFsm()).toEqual([]);
  });

  it("refuses when FSM cannot be asked (fail closed)", async () => {
    failSearches = true;
    const res = await send("DELETE", "skill/v2/skills", [{ id: OWN_SKILL }]);
    expect(res.status).toBe(403);
    expect(res.body?.error).toMatch(/could not be checked/);
    expect(writesReachingFsm()).toEqual([]);
  });
});

describe("time of check", () => {
  it("checks ownership only after the whole body has arrived", async () => {
    // A slow client holds the body open; meanwhile someone else moves the skill out of our namespace.
    let finishBody!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"endDate":'));
        finishBody = () => {
          controller.enqueue(new TextEncoder().encode('"2027-01-01"}'));
          controller.close();
        };
      },
    });
    const path = `skill/v1/tags/${OWN_TAG}/skills/${OWN_SKILL}`;
    const req = new Request(`http://localhost/api/fsm/${path}`, { method: "PATCH", body: stream, duplex: "half" } as RequestInit);
    const pending = PATCH(req, { params: Promise.resolve({ path: path.split("/") }) });

    await new Promise((r) => setTimeout(r, 20));
    ownSkillTagName = "other::Transferred";
    finishBody();

    const res = await pending;
    expect(res.status).toBe(403);
    expect(writesReachingFsm()).toEqual([]);
  });
});

describe("our own writes still reach FSM", () => {
  it.each([
    ["create the scale", "POST", "skill/v1/scales", { name: "komshiqza::Proficiency", proficiencies: [{ name: "Basic" }] }],
    ["create a tag on our scale", "POST", "skill/v2/tags", [{ name: "komshiqza::Crane", scaleId: OWN_SCALE }]],
    ["rename our tag", "POST", "skill/v2/tags", [{ id: OWN_TAG, name: "komshiqza::Welding 2", description: " ", scaleId: OWN_SCALE }]],
    ["delete our tag", "DELETE", "skill/v2/tags", [{ id: OWN_TAG }]],
    ["assign our tag", "POST", "skill/v2/skills", [{ tagId: OWN_TAG, technician: PERSON, startDate: "2026-01-01" }]],
    ["assign our tag with level and end, as the app sends it", "POST", "skill/v2/skills", [{ tagId: OWN_TAG, technician: PERSON, proficiencyId: OWN_LEVEL, startDate: "2026-01-01", endDate: "2027-01-01" }]],
    ["create the scale with its three levels, as the app sends it", "POST", "skill/v1/scales", { name: "komshiqza::Proficiency", proficiencies: [{ name: "Basic", isDefault: true }, { name: "Advanced" }, { name: "Expert" }] }],
    ["edit our skill as the app sends it", "PATCH", `skill/v1/tags/${OWN_TAG}/skills/${OWN_SKILL}`, { proficiencyId: OWN_LEVEL, startDate: "2026-01-01", endDate: "9999-12-31" }],
    ["edit our skill", "PATCH", `skill/v1/tags/${OWN_TAG}/skills/${OWN_SKILL}`, { endDate: "2027-01-01", proficiencyId: null }],
    ["delete our skill", "DELETE", "skill/v2/skills", [{ id: OWN_SKILL }]],
    ["upload a certificate to our skill", "POST", "data/v4/Attachment", upload(OWN_SKILL)],
    ["delete our certificate", "DELETE", `data/v4/Attachment/${OWN_ATTACHMENT}?forceDelete=true`, undefined],
  ] as const)("%s", async (_name, method, path, body) => {
    const res = await send(method, path, body);
    expect(res.status).toBe(200);
    expect(writesReachingFsm()).toHaveLength(1);
  });

  it("lets reads through without any check", async () => {
    const res = await send("POST", "skill/v1/skills/search", { filter: [], page: 0, size: 10 });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
  });
});

describe("certificate files are checked on the server (size and content)", () => {
  const b64 = (bytes: Uint8Array | Buffer) => Buffer.from(bytes).toString("base64");
  const pdfOfSize = (size: number) => {
    const head = Buffer.from("%PDF-1.4\n");
    return b64(Buffer.concat([head, Buffer.alloc(size - head.length, 32)]));
  };
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
  const EXE = Buffer.from("MZ\x90\x00\x03\x00\x00\x00 this program cannot be run in DOS mode");

  it.each([
    ["a PDF", { fileName: "a.pdf", type: "PDF", fileContent: PDF_B64 }],
    ["a PNG", { fileName: "a.png", type: "PNG", fileContent: b64(PNG) }],
    ["a JPEG", { fileName: "a.jpg", type: "JPEG", fileContent: b64(JPEG) }],
    ["exactly 5 MB", { fileName: "a.pdf", type: "PDF", fileContent: pdfOfSize(5 * 1024 * 1024) }],
  ])("lets %s through to FSM", async (_name, file) => {
    const res = await send("POST", "data/v4/Attachment", upload(OWN_SKILL, file));
    expect(res.status).toBe(200);
    expect(writesReachingFsm()).toHaveLength(1);
  });

  it("refuses 5 MB + 1 byte with 413", async () => {
    const res = await send("POST", "data/v4/Attachment", upload(OWN_SKILL, { fileContent: pdfOfSize(5 * 1024 * 1024 + 1) }));
    expect(res.status).toBe(413);
    expect(res.body?.code).toBe("TOO_LARGE");
    expect(writesReachingFsm()).toEqual([]);
  });

  it.each([
    ["a program renamed to cert.pdf", { fileName: "cert.pdf", type: "PDF", fileContent: b64(EXE) }],
    ["a PNG named .pdf", { fileName: "scan.pdf", type: "PDF", fileContent: b64(PNG) }],
    ["a PDF declared as PNG", { fileName: "a.png", type: "PNG", fileContent: PDF_B64 }],
    ["a declared type that does not match", { fileName: "a.pdf", type: "JPEG", fileContent: PDF_B64 }],
    ["a .docx", { fileName: "notes.docx", type: "PDF", fileContent: PDF_B64 }],
    ["no file content", { fileName: "a.pdf", type: "PDF", fileContent: undefined }],
    ["content that is not base64", { fileName: "a.pdf", type: "PDF", fileContent: "%PDF-1.4 not base64!" }],
    ["an empty file", { fileName: "a.pdf", type: "PDF", fileContent: "" }],
  ])("refuses %s with 403", async (_name, file) => {
    const res = await send("POST", "data/v4/Attachment", upload(OWN_SKILL, file));
    expect(res.status).toBe(403);
    expect(res.body?.code).toBe("BAD_FILE");
    expect(writesReachingFsm()).toEqual([]);
  });
});

describe("request bodies are bounded and must be exactly what the app sends", () => {
  const raw = async (body: BodyInit, headers: Record<string, string> = {}) => {
    const req = new Request("http://localhost/api/fsm/data/v4/Attachment", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
      duplex: "half",
    } as RequestInit);
    const res = await POST(req, { params: Promise.resolve({ path: ["data", "v4", "Attachment"] }) });
    return { status: res.status, body: (await res.json().catch(() => null)) as { code?: string } | null };
  };

  it("refuses a body that announces more than the limit, without reading it", async () => {
    const res = await raw("{}", { "content-length": String(20 * 1024 * 1024) });
    expect(res.status).toBe(413);
    expect(writesReachingFsm()).toEqual([]);
  });

  it("stops reading a streamed body that grows past the limit", async () => {
    let sent = 0;
    const chunk = new Uint8Array(1024 * 1024).fill(0x41);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 20) return controller.close();
        sent++;
        controller.enqueue(chunk);
      },
    });
    const res = await raw(stream);
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(20);
    expect(writesReachingFsm()).toEqual([]);
  });

  it("refuses a valid file with a large extra field", async () => {
    const res = await send("POST", "data/v4/Attachment", upload(OWN_SKILL, { padding: "x".repeat(1024) }));
    expect(res.status).toBe(403);
    expect(writesReachingFsm()).toEqual([]);
  });

  it("refuses duplicate keys (FSM might read the other value than we checked)", async () => {
    const valid = JSON.stringify(upload(OWN_SKILL));
    const withDuplicate = valid.replace('"fileContent":', `"fileContent":"${Buffer.from("MZ\x90").toString("base64")}","fileContent":`);
    const res = await raw(withDuplicate);
    expect(res.status).toBe(403);
    expect(writesReachingFsm()).toEqual([]);
  });

  it("refuses JSON that is not written exactly as the app writes it", async () => {
    const res = await raw(JSON.stringify(upload(OWN_SKILL), null, 2));
    expect(res.status).toBe(403);
    expect(writesReachingFsm()).toEqual([]);
  });
});
