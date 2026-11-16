/**
 * Test helper: a fake FSM behind `fetch`, shared by the repository, certificate and bulk tests.
 * Call `installFakeFsm()` at the top of a test file; set answers on `fsm` inside a test. Every request
 * is recorded in `fsm.calls`, so a test can prove which writes left the app.
 * Each test file must also mock `fileToBase64` (Node has no FileReader), see the test files.
 */
import { afterEach, beforeEach, vi } from "vitest";

export const DEMO_TAG = "C99F18163E7E42D4ACEB8349FDB313B7"; // "Gasnetz-Anschluss" in the demo company
export const OWN_TAG = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
export const SKILL = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
export const ATTACHMENT = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
export const PERSON = "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";

interface Call {
  method: string;
  path: string;
  body: unknown;
}

type BulkAnswer = (path: string, method: string, body: unknown) => { hasErrors: boolean; results: unknown[] } | null;

/** The fake's state; reset before every test. */
export const fsm = {
  calls: [] as Call[],
  /** Attachments deleted through the fake, so later queries no longer return them (like real FSM). */
  deletedAttachments: new Set<string>(),
  /** Answers a CoreSQL query by looking at the SQL. */
  queryAnswer: (() => []) as (sql: string) => unknown[],
  searchAnswer: (() => []) as (path: string, filter: { field: string; value: unknown }[]) => unknown[],
  attachmentAnswer: null as unknown,
  /** Attachment uploads with these file names fail. */
  failingUploads: new Set<string>(),
  /** Attachment uploads with these file names never get an answer. */
  hangingUploads: new Set<string>(),
  /** Attachments FSM has on our skill (used by the timeout checks). */
  fsmAttachments: [] as { id: string; fileName: string; description?: string; content?: string }[],
  /** Downloading an attachment's content fails. */
  contentFails: false,
  /** A hanging upload is still stored (the write arrived, only the answer is lost). */
  hangingUploadsArrive: false,
  /** CoreSQL queries fail. */
  queriesFail: false,
  /** Skill Service writes to this path never get an answer (e.g. "skill/v2/skills"). */
  hangingWrite: null as string | null,
  /** Answer of bulk (v2) writes; default: every item succeeded. */
  bulkAnswer: (() => null) as BulkAnswer,
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

const neverAnswered = (init: RequestInit) =>
  new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));

async function fakeFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = new URL(input, "http://localhost");
  const method = (init.method ?? "GET").toUpperCase();
  const body = init.body ? JSON.parse(String(init.body)) : undefined;
  const path = url.pathname.replace("/api/fsm/", "");
  fsm.calls.push({ method, path, body });

  if (path.startsWith("data/v4/Attachment/") && method === "DELETE") fsm.deletedAttachments.add(path.split("/")[3]);
  if (path === "query/v1" && fsm.queriesFail) return json({ error: "simulated outage" }, 503);
  if (path === "query/v1") {
    const rows = fsm.queryAnswer(body.query).filter((r) => !fsm.deletedAttachments.has((r as { a?: { id: string } }).a?.id ?? ""));
    return json({ data: rows, lastPage: 1 });
  }
  if (path.endsWith("/search")) return json({ content: fsm.searchAnswer(path, body.filter ?? []), last: true, totalElements: 0 });
  if (path.endsWith("/content") && method === "GET") {
    const stored = fsm.fsmAttachments.find((x) => x.id === path.split("/")[3]);
    if (stored) return fsm.contentFails ? json({ error: "simulated outage" }, 503) : new Response(stored.content ?? "", { status: 200 });
    return fsm.attachmentAnswer
      ? new Response("%PDF-1.4 dummy", { status: 200, headers: { "content-type": "application/pdf;charset=ISO-8859-1" } })
      : json({ error: "CA-20", message: "CA-20: Object Attachment with id CCCC… not found" }, 404);
  }
  if (path.startsWith("data/v4/Attachment/") && method === "GET") {
    return fsm.attachmentAnswer ? json({ data: [{ attachment: fsm.attachmentAnswer }] }) : json({ error: "not found" }, 404);
  }
  if (path === "skill/v1/scales" && method === "POST") return json("EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE");
  if (path === fsm.hangingWrite) return neverAnswered(init);
  if (path.startsWith("skill/v2/")) {
    return json(fsm.bulkAnswer(path, method, body) ?? { hasErrors: false, results: [{ status: 200, resource: { id: SKILL, ...body?.[0] } }] }, 207);
  }
  if (path.startsWith("data/v4/Attachment") && method === "POST") {
    if (fsm.failingUploads.has(body.fileName)) return json({ error: "CA-999", message: "CA-999: simulated upload failure" }, 500);
    const content = Buffer.from(body.fileContent, "base64").toString("latin1");
    if (fsm.hangingUploads.has(body.fileName)) {
      if (fsm.hangingUploadsArrive) {
        fsm.fsmAttachments.push({ id: `${"A".repeat(28)}${String(fsm.fsmAttachments.length).padStart(4, "0")}`, fileName: body.fileName, description: body.description, content });
      }
      return neverAnswered(init);
    }
    fsm.fsmAttachments.push({ id: `${ATTACHMENT.slice(0, 28)}${String(fsm.fsmAttachments.length).padStart(4, "0")}`, fileName: body.fileName, description: body.description, content });
    return json({ data: [{ attachment: { id: ATTACHMENT, fileName: body.fileName, type: body.type, object: { objectId: SKILL, objectType: "SKILL" } } }] });
  }
  return json({});
}

/** Installs the fake FSM for every test of the calling file, with a fresh state each time. */
export function installFakeFsm(): void {
  beforeEach(() => {
    Object.assign(fsm, {
      calls: [],
      deletedAttachments: new Set(),
      queryAnswer: () => [],
      searchAnswer: () => [],
      attachmentAnswer: null,
      failingUploads: new Set(),
      hangingUploads: new Set(),
      fsmAttachments: [],
      contentFails: false,
      hangingUploadsArrive: false,
      queriesFail: false,
      hangingWrite: null,
      bulkAnswer: () => null,
    });
    vi.stubGlobal("fetch", fakeFetch);
  });
  afterEach(() => vi.unstubAllGlobals());
}

/** Requests that change data (searches and CoreSQL queries are reads). */
export function writes() {
  return fsm.calls.filter((c) => c.method !== "GET" && c.path !== "query/v1" && !c.path.endsWith("/search"));
}

/** Skill Service answers for the ownership lookups (tag by id, skill by id). */
export const tagNamed = (name: string) => (path: string) => (path === "skill/v1/tags/search" ? [{ id: DEMO_TAG, name }] : []);
export const skillOfTag = (name: string) => (path: string) =>
  path === "skill/v1/skills/search" ? [{ id: SKILL, tagId: OWN_TAG, tagName: name, technicianId: PERSON }] : [];
export const pdf = () => new File(["%PDF-1.4 dummy"], "cert.pdf", { type: "application/pdf" });
/** What the user confirmed in the delete dialog when the skill was not in use. */
export const NOTHING_CONFIRMED = { skillIds: [], certificateIds: [] };
