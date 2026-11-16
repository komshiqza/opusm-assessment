/**
 * Thin browser-side FSM client. Every call goes through the pre-built proxy `/api/fsm/...`,
 * which adds the token and SAP headers. Use it, extend it, or wrap it (e.g. in React Query).
 *
 * See docs/FSM_GUIDE.md for the data model, CoreSQL examples and attachment handling.
 */
import { DTO, dtosParam, type DtoEntity } from "./dtos";

export class FsmError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "FsmError";
  }
}

const PROXY = "/api/fsm";
const MAX_PAGE_SIZE = 1000;

async function call<T>(path: string, init: RequestInit & { params?: Record<string, string | number | boolean> } = {}): Promise<T> {
  const { params, ...rest } = init;
  const qs = params ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}` : "";
  const res = await fetch(`${PROXY}/${path}${qs}`, {
    ...rest,
    headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) },
  });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const message =
      (data && typeof data === "object" && ("message" in data || "error" in data)
        ? String((data as Record<string, unknown>).message ?? (data as Record<string, unknown>).error)
        : text) || `FSM request failed (${res.status})`;
    throw new FsmError(message, res.status, data);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Data API wraps each entity: `{ data: [ { tag: {...} } ] }`. */
function unwrap<T>(payload: unknown, entity: DtoEntity): T[] {
  const key = entity.charAt(0).toLowerCase() + entity.slice(1);
  const rows = (payload as { data?: Record<string, T>[] })?.data ?? [];
  return rows.map((row) => row[key]).filter((v): v is T => v != null);
}

/**
 * CoreSQL via the Query API. Rows keep their aliases: `SELECT s, t FROM Skill s JOIN Tag t ...`
 * returns `[{ s: {...}, t: {...} }]`. Fetches all pages (Query API pages are 1-based).
 */
export async function fsmQuery<Row extends Record<string, unknown>>(sql: string, entities: DtoEntity[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let page = 1; page <= 100; page++) {
    const res = await call<{ data?: Row[]; lastPage?: number }>("query/v1", {
      method: "POST",
      params: { dtos: dtosParam(entities), page, pageSize: MAX_PAGE_SIZE },
      body: JSON.stringify({ query: sql }),
    });
    out.push(...(res.data ?? []));
    if (!res.lastPage || page >= res.lastPage) break;
  }
  return out;
}

/** Data API: read one object by id (null when not found). */
export async function fsmGet<T>(entity: DtoEntity, id: string): Promise<T | null> {
  try {
    const res = await call<unknown>(`data/v4/${entity}/${encodeURIComponent(id)}`, { params: { dtos: DTO[entity] } });
    return unwrap<T>(res, entity)[0] ?? null;
  } catch (e) {
    if (e instanceof FsmError && e.status === 404) return null;
    throw e;
  }
}

/** Data API: create. Returns the created object (with its new `id`). */
export async function fsmCreate<T>(entity: DtoEntity, body: Record<string, unknown>): Promise<T> {
  const res = await call<unknown>(`data/v4/${entity}`, {
    method: "POST",
    params: { dtos: DTO[entity] },
    body: JSON.stringify(body),
  });
  const created = unwrap<T>(res, entity)[0];
  if (!created) throw new FsmError(`Create ${entity} returned no object`, 500, res);
  return created;
}

/** Data API: partial update (PATCH, `forceUpdate=true`). */
export async function fsmUpdate<T>(entity: DtoEntity, id: string, body: Record<string, unknown>): Promise<T> {
  const res = await call<unknown>(`data/v4/${entity}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    params: { dtos: DTO[entity], forceUpdate: true },
    body: JSON.stringify(body),
  });
  return (unwrap<T>(res, entity)[0] ?? ({ id, ...body } as T)) as T;
}

/** Data API: delete (`forceDelete=true`; FSM rejects `dtos` on DELETE). */
export async function fsmDelete(entity: DtoEntity, id: string): Promise<void> {
  await call<unknown>(`data/v4/${entity}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    params: { forceDelete: true },
  });
}

/** URL that streams an attachment's binary through the proxy (usable in <a href>, <img src>, <iframe>). */
export function attachmentContentUrl(attachmentId: string): string {
  return `${PROXY}/data/v4/Attachment/${encodeURIComponent(attachmentId)}/content`;
}

/** File → base64 (without the `data:...;base64,` prefix), as expected by `Attachment.fileContent`. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// --- Skill Service API (/cloud-skill-service) ------------------------------------
// Scales, proficiencies (levels) and skills with proficiency. See docs/FSM_GUIDE.md, section 3.

export interface SkillFilter {
  /** e.g. "name", "tag.id", "tag.name", "technicianId" */
  field: string;
  /** e.g. "=", "like" (with % wildcards), "contains" */
  operator: string;
  value: unknown;
}

interface SkillPage<T> {
  content: T[];
  last: boolean;
  totalElements: number;
}

/** Raw call to the Skill Service, e.g. `skillApi("v2/tags", { method: "POST", body: [...] })`. */
export async function skillApi<T>(path: string, init: { method?: string; body?: unknown; params?: Record<string, string | number | boolean> } = {}): Promise<T> {
  return call<T>(`skill/${path}`, {
    method: init.method ?? "GET",
    params: init.params,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/**
 * `POST <path>/search` with all pages loaded (Skill Service pages are 0-based, max size 1000).
 * Example: `skillSearch<SkillServiceSkill>("v1/skills", [{ field: "tag.name", operator: "like", value: "jdoe::%" }])`
 */
export async function skillSearch<T>(path: string, filter: SkillFilter[] = [], sort?: { property: string; direction: "ASC" | "DESC" }[]): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < 100; page++) {
    const res = await skillApi<SkillPage<T>>(`${path}/search`, {
      method: "POST",
      body: { filter, page, size: MAX_PAGE_SIZE, ...(sort ? { sort } : {}) },
    });
    out.push(...(res.content ?? []));
    if (res.last || !res.content?.length) break;
  }
  return out;
}

/** Bulk endpoints (v2) answer HTTP 207 with per-item results. This throws if any item failed. */
export function assertBulkOk<T>(res: { hasErrors: boolean; results: { status: number; resource?: T; error?: { detail?: string; title?: string } }[] }): T[] {
  if (res.hasErrors) {
    const failed = res.results.find((r) => r.status >= 400);
    throw new FsmError(failed?.error?.detail ?? failed?.error?.title ?? "Bulk operation failed", failed?.status ?? 400, res);
  }
  return res.results.map((r) => r.resource).filter((v): v is T => v != null);
}
