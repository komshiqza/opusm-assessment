import "server-only";
/**
 * Server-side ownership check for every write that passes the proxy's allowlist.
 *
 * The proxy (src/app/api/fsm/[...path]/route.ts) limits writes to certain entity types. This check
 * adds the per-record rule of the shared company, on the server, where a browser cannot skip it:
 * only Tags/Scales named `<CANDIDATE_ID>::…`, Skills of those Tags and Attachments of those Skills.
 *
 * - Only the writes this app makes are recognised; any other write is refused (default deny).
 * - Every target is read fresh from FSM (Skill Service for tags, skills and scales; Data API for
 *   attachments), never taken from the request alone.
 * - If FSM cannot be asked, or the body cannot be read, the write is refused (fail closed).
 * - Certificate uploads must also pass the shared file rules: decoded size ≤ 5 MB, content is a
 *   real PDF/PNG/JPEG (magic bytes), and name and declared type match the content.
 * The browser keeps its own guard (src/lib/fsm/guard.ts) for fast feedback; this one decides.
 */
import { NAME_PREFIX, isOwnName } from "@/lib/candidate";
import { MAX_CERTIFICATE_BYTES, MAX_CERTIFICATE_LABEL, SIGNATURE_BYTES, checkCertificate } from "@/lib/domain/certificateRules";
import { DTO } from "./dtos";
import { fsmHeaders } from "./headers";
import { OwnershipError, assertFsmId, assertOwnName } from "./guard";
import { getFsmSession } from "./token";

/** Fresh reads the check needs. Injected in tests; `fsmOwnershipReader()` asks the real FSM. */
export interface OwnershipReader {
  /** Own tags (exact, case-sensitive prefix): id → scaleId */
  ownTags(): Promise<Map<string, { scaleId: string | null }>>;
  /** Skills of own tags: id → tag id */
  ownSkills(): Promise<Map<string, { tagId: string }>>;
  /** Own scale ids */
  ownScales(): Promise<Set<string>>;
  /** The object an attachment is linked to, or null if it does not exist */
  attachment(id: string): Promise<{ objectType: string; objectId: string } | null>;
}

/** Most items one bulk write may carry (the app sends a handful). */
const MAX_BULK_ITEMS = 200;

type Body = () => Promise<unknown>;

/** Why a write is refused: HTTP status, short code and a message for the user. */
export interface Refusal {
  status: number;
  code: "NOT_OWN" | "BAD_FILE" | "TOO_LARGE";
  message: string;
}

/** A certificate file that breaks the shared rules (src/lib/domain/certificateRules.ts). */
class FileRuleError extends Error {
  constructor(
    message: string,
    readonly tooLarge = false,
  ) {
    super(message);
  }
}

const notOwn = (message: string): Refusal => ({ status: 403, code: "NOT_OWN", message });

/**
 * Returns null when the request may go on to FSM, otherwise why it is refused.
 * Reads (GET/HEAD, `.../search`, Query API) always pass.
 */
export async function checkWriteOwnership(segments: string[], method: string, body: Body, reader: OwnershipReader): Promise<Refusal | null> {
  if (method === "GET" || method === "HEAD") return null;
  const [api, version, ...rest] = segments;
  if (api === "query" && version === "v1" && rest.length === 0 && method === "POST") return null;
  if (api === "skill" && method === "POST" && rest[rest.length - 1] === "search") return null;

  try {
    if (segments.some((s) => !s || s.includes("/") || s === "." || s === "..")) return notOwn(`Refused: unexpected path "${segments.join("/")}".`);
    const key = `${method} ${api}/${version}/${rest.map((s, i) => (i === 0 || /^(skills|search)$/.test(s) ? s : ":id")).join("/")}`;
    const check = CHECKS[key];
    if (!check) return notOwn(`Refused: ${method} ${segments.join("/")} is not a write this app makes.`);
    // Receive the whole body before any ownership lookup, so a slow client cannot hold a finished
    // check open while ownership changes in FSM. A body that cannot be read is refused when used.
    const received = await body().then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const }),
    );
    const parsedBody: Body = async () => {
      if (!received.ok) throw new OwnershipError("Refused: the request body is not valid JSON.");
      return received.value;
    };
    await check({ rest, body: parsedBody, reader });
    return null;
  } catch (e) {
    if (e instanceof FileRuleError) return { status: e.tooLarge ? 413 : 403, code: e.tooLarge ? "TOO_LARGE" : "BAD_FILE", message: e.message };
    if (e instanceof OwnershipError) return notOwn(e.message);
    return notOwn(`Refused: the ownership of this write could not be checked (${e instanceof Error ? e.message : String(e)}).`);
  }
}

interface CheckInput {
  rest: string[];
  body: Body;
  reader: OwnershipReader;
}

/** The writes the app makes, by method and path shape. Anything else has no entry and is refused. */
const CHECKS: Record<string, (input: CheckInput) => Promise<void>> = {
  // Create the proficiency scale
  "POST skill/v1/scales": async ({ body }) => {
    const scale = asObject(await body());
    assertOwnName(asString(scale.name, "scale name"), "Scale");
  },

  // Create or update (rename) tags
  "POST skill/v2/tags": async ({ body, reader }) => {
    for (const item of asItems(await body())) {
      assertOwnName(asString(item.name, "tag name"), "Tag");
      if (item.id !== undefined) await assertOwnTag(asId(item.id), reader);
      if (item.scaleId !== undefined && item.scaleId !== null) await assertOwnScale(asId(item.scaleId), reader);
    }
  },

  "DELETE skill/v2/tags": async ({ body, reader }) => {
    for (const item of asItems(await body())) await assertOwnTag(asId(item.id), reader);
  },

  // Create skills (assignments)
  "POST skill/v2/skills": async ({ body, reader }) => {
    for (const item of asItems(await body())) {
      await assertOwnTag(asId(item.tagId), reader);
      if (item.id !== undefined) await assertOwnSkill(asId(item.id), reader);
    }
  },

  "DELETE skill/v2/skills": async ({ body, reader }) => {
    for (const item of asItems(await body())) await assertOwnSkill(asId(item.id), reader);
  },

  // Change validity or level: PATCH skill/v1/tags/{tagId}/skills/{skillId}
  "PATCH skill/v1/tags/:id/skills/:id": async ({ rest, body, reader }) => {
    const [, tagId, , skillId] = rest;
    const skill = await assertOwnSkill(asId(skillId), reader);
    if (skill.tagId !== asId(tagId)) throw new OwnershipError("Refused: this skill does not belong to the tag in the path.");
    const patch = asObject(await body());
    if (patch.tagId !== undefined && patch.tagId !== skill.tagId) throw new OwnershipError("Refused: moving a skill to another tag is not allowed.");
  },

  // Upload a certificate: POST data/v4/Attachment. The file itself is checked first (no FSM call).
  "POST data/v4/Attachment": async ({ body, reader }) => {
    const attachment = asObject(await body());
    assertCertificateFile(attachment);
    const object = asObject(attachment.object);
    if (object.objectType !== "SKILL") throw new OwnershipError("Refused: attachments may only be linked to a SKILL.");
    await assertOwnSkill(asId(object.objectId), reader);
  },

  // Delete a certificate: DELETE data/v4/Attachment/{id}
  "DELETE data/v4/Attachment/:id": async ({ rest, reader }) => {
    const attachment = await reader.attachment(asId(rest[1]));
    if (!attachment || attachment.objectType !== "SKILL") throw new OwnershipError("Refused: the attachment was not found or is not linked to a skill.");
    await assertOwnSkill(asId(attachment.objectId), reader);
  },
};

/** Largest base64 text a 5 MB file can produce; anything longer is refused before decoding. */
const MAX_BASE64_LENGTH = Math.ceil(MAX_CERTIFICATE_BYTES / 3) * 4;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Same rules as the browser: real decoded size, content type by magic bytes, matching name and declared type. */
function assertCertificateFile(attachment: Record<string, unknown>) {
  const { fileName, type, fileContent } = attachment;
  if (typeof fileName !== "string" || typeof type !== "string" || typeof fileContent !== "string") {
    throw new FileRuleError("Refused: a certificate needs a file name, a type and the file content.");
  }
  if (fileContent.length > MAX_BASE64_LENGTH) throw new FileRuleError(`Refused: ${fileName} is larger than ${MAX_CERTIFICATE_LABEL}, the limit per certificate.`, true);
  if (fileContent.length % 4 !== 0 || !BASE64.test(fileContent)) throw new FileRuleError(`Refused: the content of ${fileName} is not valid base64.`);
  const bytes = Buffer.from(fileContent, "base64");
  const check = checkCertificate({ fileName, size: bytes.length, head: bytes.subarray(0, SIGNATURE_BYTES), declaredType: type });
  if (!check.ok) throw new FileRuleError(`Refused: ${check.error}`, check.tooLarge);
}

async function assertOwnTag(id: string, reader: OwnershipReader) {
  if (!(await reader.ownTags()).has(id)) throw new OwnershipError(`Refused: tag ${id} is not in your namespace "${NAME_PREFIX}".`);
}

async function assertOwnSkill(id: string, reader: OwnershipReader): Promise<{ tagId: string }> {
  const skill = (await reader.ownSkills()).get(id);
  if (!skill) throw new OwnershipError(`Refused: skill ${id} does not belong to one of your tags.`);
  return skill;
}

async function assertOwnScale(id: string, reader: OwnershipReader) {
  if (!(await reader.ownScales()).has(id)) throw new OwnershipError(`Refused: scale ${id} is not in your namespace "${NAME_PREFIX}".`);
}

// --- Body helpers: anything unexpected is refused ------------------------------------------

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new OwnershipError("Refused: unexpected request body.");
  return value as Record<string, unknown>;
}

function asItems(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BULK_ITEMS) {
    throw new OwnershipError(`Refused: a bulk write needs 1 to ${MAX_BULK_ITEMS} items.`);
  }
  return value.map(asObject);
}

function asString(value: unknown, what: string): string {
  if (typeof value !== "string") throw new OwnershipError(`Refused: ${what} is missing.`);
  return value;
}

function asId(value: unknown): string {
  const id = asString(value, "id");
  assertFsmId(id);
  return id;
}

// --- Real FSM reads (server only) ------------------------------------------------------------

/** Reads from the real FSM with the server's token. Each list is loaded at most once per request. */
export function fsmOwnershipReader(): OwnershipReader {
  const once = <T>(load: () => Promise<T>) => {
    let cached: Promise<T> | null = null;
    return () => (cached ??= load());
  };
  return {
    ownTags: once(async () => {
      const tags = await skillServiceSearch<{ id: string; name: string; scaleId: string | null; deleted?: boolean }>("v1/tags", "name");
      return new Map(tags.filter((t) => !t.deleted && isOwnName(t.name)).map((t) => [t.id, { scaleId: t.scaleId ?? null }]));
    }),
    ownSkills: once(async () => {
      const skills = await skillServiceSearch<{ id: string; tagId: string; tagName: string; deleted?: boolean }>("v1/skills", "tag.name");
      return new Map(skills.filter((s) => !s.deleted && isOwnName(s.tagName)).map((s) => [s.id, { tagId: s.tagId }]));
    }),
    ownScales: once(async () => {
      const scales = await skillServiceSearch<{ id: string; name: string; deleted?: boolean }>("v1/scales", "name");
      return new Set(scales.filter((s) => !s.deleted && isOwnName(s.name)).map((s) => s.id));
    }),
    attachment: async (id) => {
      const res = await fsmFetch(`/api/data/v4/Attachment/${encodeURIComponent(id)}?dtos=${DTO.Attachment}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`FSM answered ${res.status}`);
      const data = (await res.json()) as { data?: { attachment?: { object?: { objectType: string; objectId: string } } }[] };
      return data.data?.[0]?.attachment?.object ?? null;
    },
  };
}

async function fsmFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = await getFsmSession();
  return fetch(`${session.clusterUrl}${path}`, {
    ...init,
    headers: {
      ...fsmHeaders(session.accountId, session.companyId),
      Authorization: `Bearer ${session.token}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
  });
}

/** Everything in the own namespace from one Skill Service search, all pages. */
async function skillServiceSearch<T>(resource: string, nameField: string): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < 50; page++) {
    const res = await fsmFetch(`/cloud-skill-service/api/${resource}/search`, {
      method: "POST",
      body: JSON.stringify({ filter: [{ field: nameField, operator: "like", value: `${NAME_PREFIX}%` }], page, size: 1000 }),
    });
    if (!res.ok) throw new Error(`FSM answered ${res.status}`);
    const data = (await res.json()) as { content?: T[]; last?: boolean };
    out.push(...(data.content ?? []));
    if (data.last !== false || !data.content?.length) return out;
  }
  throw new Error("too many pages");
}
