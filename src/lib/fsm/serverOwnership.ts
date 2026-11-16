import "server-only";
/**
 * Server-side ownership check for every write that passes the proxy's allowlist.
 *
 * The proxy (src/app/api/fsm/[...path]/route.ts) limits writes to certain entity types. This check
 * adds the per-record rule of the shared company, on the server, where a browser cannot skip it:
 * only Tags/Scales named `<CANDIDATE_ID>::…`, Skills of those Tags and Attachments of those Skills.
 *
 * - Only the writes this app makes are recognised; any other write is refused (default deny).
 * - Each write may carry only the fields the app itself sends (an exact allowlist), with the expected
 *   types; any other field, e.g. a nested `tag` or a foreign `id`, is refused.
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
  /** Ids of the levels (proficiencies) of own scales */
  ownLevels(): Promise<Set<string>>;
  /** The object an attachment is linked to, or null if it does not exist */
  attachment(id: string): Promise<{ objectType: string; objectId: string } | null>;
}

/** Most items one bulk write may carry (the app sends a handful). */
const MAX_BULK_ITEMS = 200;

type Body = () => Promise<unknown>;

/** Largest base64 text a 5 MB file can produce. */
const MAX_BASE64_LENGTH = Math.ceil(MAX_CERTIFICATE_BYTES / 3) * 4;
/** Largest request body: one certificate in base64 plus room for its other fields. */
export const MAX_REQUEST_BYTES = MAX_BASE64_LENGTH + 64 * 1024;

/** Reads the body up to `limit` bytes; null when it is (or announces to be) larger. Stops reading early. */
async function readBodyLimited(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) return null;
  const stream = request.clone().body;
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      // Cancel both halves of the cloned stream so the client's upload is not read any further.
      // Not awaited: each half's cancel only completes once the other half is cancelled too.
      void reader.cancel().catch(() => {});
      void request.body?.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * The body must be exactly what the app's client sends (`JSON.stringify` output). That refuses
 * duplicate keys, where FSM might read a different value than the one checked here.
 */
function parseExactJson(text: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new OwnershipError("Refused: the request body is not valid JSON.");
  }
  if (JSON.stringify(value) !== text) throw new OwnershipError("Refused: the request body is not written the way this app writes it.");
  return value;
}

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
export async function checkWriteOwnership(segments: string[], method: string, request: Request, reader: OwnershipReader): Promise<Refusal | null> {
  if (method === "GET" || method === "HEAD") return null;

  // Every request with a body is size-limited before it is read into memory or parsed.
  const text = await readBodyLimited(request, MAX_REQUEST_BYTES);
  if (text === null) {
    return { status: 413, code: "TOO_LARGE", message: `Refused: the request is larger than ${MAX_CERTIFICATE_LABEL} plus a small margin.` };
  }

  const [api, version, ...rest] = segments;
  if (api === "query" && version === "v1" && rest.length === 0 && method === "POST") return null;
  if (api === "skill" && method === "POST" && rest[rest.length - 1] === "search") return null;

  try {
    if (segments.some((s) => !s || s.includes("/") || s === "." || s === "..")) return notOwn(`Refused: unexpected path "${segments.join("/")}".`);
    const key = `${method} ${api}/${version}/${rest.map((s, i) => (i === 0 || /^(skills|search)$/.test(s) ? s : ":id")).join("/")}`;
    const check = CHECKS[key];
    if (!check) return notOwn(`Refused: ${method} ${segments.join("/")} is not a write this app makes.`);
    // The whole body is already received (above), before any ownership lookup, so a slow client
    // cannot hold a finished check open while ownership changes in FSM.
    const parsedBody: Body = async () => parseExactJson(text);
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
  // Create the proficiency scale: { name, proficiencies: [{ name, isDefault? }] }
  "POST skill/v1/scales": async ({ body }) => {
    const scale = onlyFields(asObject(await body()), ["name", "proficiencies"], "scale");
    assertOwnName(asString(scale.name, "scale name"), "Scale");
    const levels = scale.proficiencies;
    if (!Array.isArray(levels) || levels.length === 0 || levels.length > 10) throw new OwnershipError("Refused: a scale needs 1 to 10 levels.");
    for (const level of levels.map(asObject)) {
      onlyFields(level, ["name", "isDefault"], "scale level");
      asString(level.name, "level name");
      if (level.isDefault !== undefined && typeof level.isDefault !== "boolean") throw new OwnershipError("Refused: unexpected value for isDefault.");
    }
  },

  // Create or update (rename) tags: [{ id?, name, description?, scaleId? }]
  "POST skill/v2/tags": async ({ body, reader }) => {
    for (const item of asItems(await body())) {
      onlyFields(item, ["id", "name", "description", "scaleId"], "tag");
      assertOwnName(asString(item.name, "tag name"), "Tag");
      if (item.description !== undefined) asString(item.description, "description");
      if (item.id !== undefined) await assertOwnTag(asId(item.id), reader);
      if (item.scaleId !== undefined) await assertOwnScale(asId(item.scaleId), reader);
    }
  },

  "DELETE skill/v2/tags": async ({ body, reader }) => {
    for (const item of asItems(await body())) await assertOwnTag(asId(onlyFields(item, ["id"], "tag").id), reader);
  },

  // Create skills (assignments): [{ tagId, technician, proficiencyId?, startDate, endDate? }]
  "POST skill/v2/skills": async ({ body, reader }) => {
    for (const item of asItems(await body())) {
      onlyFields(item, ["tagId", "technician", "proficiencyId", "startDate", "endDate"], "skill");
      await assertOwnTag(asId(item.tagId), reader);
      asId(item.technician);
      if (item.proficiencyId !== undefined) await assertOwnLevel(asId(item.proficiencyId), reader);
      asDate(item.startDate);
      if (item.endDate !== undefined) asDate(item.endDate);
    }
  },

  "DELETE skill/v2/skills": async ({ body, reader }) => {
    for (const item of asItems(await body())) await assertOwnSkill(asId(onlyFields(item, ["id"], "skill").id), reader);
  },

  // Change validity or level: PATCH skill/v1/tags/{tagId}/skills/{skillId} with { proficiencyId?, startDate?, endDate? }
  "PATCH skill/v1/tags/:id/skills/:id": async ({ rest, body, reader }) => {
    const [, tagId, , skillId] = rest;
    const skill = await assertOwnSkill(asId(skillId), reader);
    if (skill.tagId !== asId(tagId)) throw new OwnershipError("Refused: this skill does not belong to the tag in the path.");
    const patch = onlyFields(asObject(await body()), ["proficiencyId", "startDate", "endDate"], "skill change");
    if (patch.proficiencyId !== undefined && patch.proficiencyId !== null) await assertOwnLevel(asId(patch.proficiencyId), reader);
    if (patch.startDate !== undefined) asDate(patch.startDate);
    if (patch.endDate !== undefined) asDate(patch.endDate);
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

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Same rules as the browser: real decoded size, content type by magic bytes, matching name and declared type. */
const ATTACHMENT_FIELDS = new Set(["fileName", "title", "description", "type", "fileContent", "object"]);
const OBJECT_FIELDS = new Set(["objectId", "objectType"]);

function assertCertificateFile(attachment: Record<string, unknown>) {
  const unknown = [...Object.keys(attachment).filter((k) => !ATTACHMENT_FIELDS.has(k)), ...Object.keys(asObject(attachment.object)).filter((k) => !OBJECT_FIELDS.has(k))];
  if (unknown.length) throw new FileRuleError(`Refused: unexpected fields in the certificate upload (${unknown.join(", ")}).`);
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

/** A level may only come from one of our own scales (the app only offers those). */
async function assertOwnLevel(id: string, reader: OwnershipReader) {
  if (!(await reader.ownLevels()).has(id)) throw new OwnershipError(`Refused: level ${id} is not a level of a scale in your namespace "${NAME_PREFIX}".`);
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

/** The object, if it has no field outside `allowed`; otherwise the write is refused. */
function onlyFields(value: Record<string, unknown>, allowed: string[], what: string): Record<string, unknown> {
  const unexpected = Object.keys(value).filter((k) => !allowed.includes(k));
  if (unexpected.length) throw new OwnershipError(`Refused: unexpected fields in the ${what} (${unexpected.join(", ")}).`);
  return value;
}

/** A date as the app sends it: yyyy-mm-dd. */
function asDate(value: unknown): string {
  const date = asString(value, "date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new OwnershipError("Refused: a date must be written as yyyy-mm-dd.");
  return date;
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
  const ownScales = once(async () => {
    const scales = await skillServiceSearch<{ id: string; name: string; deleted?: boolean }>("v1/scales", "name");
    return new Set(scales.filter((s) => !s.deleted && isOwnName(s.name)).map((s) => s.id));
  });
  return {
    ownTags: once(async () => {
      const tags = await skillServiceSearch<{ id: string; name: string; scaleId: string | null; deleted?: boolean }>("v1/tags", "name");
      return new Map(tags.filter((t) => !t.deleted && isOwnName(t.name)).map((t) => [t.id, { scaleId: t.scaleId ?? null }]));
    }),
    ownSkills: once(async () => {
      const skills = await skillServiceSearch<{ id: string; tagId: string; tagName: string; deleted?: boolean }>("v1/skills", "tag.name");
      return new Map(skills.filter((s) => !s.deleted && isOwnName(s.tagName)).map((s) => [s.id, { tagId: s.tagId }]));
    }),
    ownScales,
    ownLevels: once(async () => {
      const ids = new Set<string>();
      for (const scaleId of await ownScales()) {
        for (const level of await skillServiceSearch<{ id: string }>(`v1/scales/${encodeURIComponent(scaleId)}/proficiencies`, null)) ids.add(level.id);
      }
      return ids;
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

/** One Skill Service search, all pages: everything in the own namespace (`nameField`), or everything under `resource` (null). */
async function skillServiceSearch<T>(resource: string, nameField: string | null): Promise<T[]> {
  const out: T[] = [];
  const filter = nameField ? [{ field: nameField, operator: "like", value: `${NAME_PREFIX}%` }] : [];
  for (let page = 0; page < 50; page++) {
    const res = await fsmFetch(`/cloud-skill-service/api/${resource}/search`, {
      method: "POST",
      body: JSON.stringify({ filter, page, size: 1000 }),
    });
    if (!res.ok) throw new Error(`FSM answered ${res.status}`);
    const data = (await res.json()) as { content?: T[]; last?: boolean };
    out.push(...(data.content ?? []));
    if (data.last !== false || !data.content?.length) return out;
  }
  throw new Error("too many pages");
}
