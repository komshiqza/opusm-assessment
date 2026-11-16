/**
 * Thin browser-side FSM client. Every call goes through the pre-built proxy `/api/fsm/...`,
 * which adds the token and SAP headers. Use it, extend it, or wrap it (e.g. in React Query).
 *
 * See docs/FSM_GUIDE.md for the data model, CoreSQL examples and attachment handling.
 */
import { DTO, dtosParam, type DtoEntity } from "./dtos";
import { t } from "@/lib/i18n/t";

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

/** How long the app waits for FSM before giving up on a request (a hung request would lock a dialog). */
export const FSM_TIMEOUT_MS = 60_000;

/**
 * FSM did not answer in time. For a write the result is unknown: FSM may have saved it, so the user
 * must check (reload) before trying again, never simply retry.
 */
export class FsmTimeoutError extends FsmError {
  /**
   * FSM gave no answer: it did not answer in time ("timeout"), or the connection broke ("connection").
   * For a write the result is unknown either way: FSM may have saved it.
   */
  constructor(
    public readonly write: boolean,
    reason: "timeout" | "connection" = "timeout",
  ) {
    const seconds = FSM_TIMEOUT_MS / 1000;
    super(
      reason === "timeout"
        ? t(write ? "fsm.timeoutWrite" : "fsm.timeoutRead", { seconds })
        : t(write ? "fsm.connectionWrite" : "fsm.connectionRead"),
      0,
    );
    this.name = "FsmTimeoutError";
  }
}

const PROXY = "/api/fsm";
const MAX_PAGE_SIZE = 1000;

/** Searches (Skill Service) and CoreSQL queries use POST but only read. */
const isRead = (path: string, method: string) => method === "GET" || path.startsWith("query/") || path.endsWith("/search");

/** fetch with the FSM time limit; a timeout becomes FsmTimeoutError (reading the body counts too). */
async function fetchWithTimeout<T>(url: string, init: RequestInit, write: boolean, read: (res: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FSM_TIMEOUT_MS);
  try {
    return await read(await fetch(url, { ...init, signal: controller.signal }));
  } catch (e) {
    if (controller.signal.aborted) throw new FsmTimeoutError(write);
    // fetch rejects with a TypeError when the connection breaks: no answer, like a timeout.
    if (e instanceof TypeError) throw new FsmTimeoutError(write, "connection");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function call<T>(path: string, init: RequestInit & { params?: Record<string, string | number | boolean> } = {}): Promise<T> {
  const { params, ...rest } = init;
  const qs = params ? `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}` : "";
  const method = (rest.method ?? "GET").toUpperCase();
  const requestInit = { ...rest, headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) } };
  const write = !isRead(path, method);
  return fetchWithTimeout(`${PROXY}/${path}${qs}`, requestInit, write, async (res) => {
    const text = await res.text();
    const data = text ? safeJson(text) : null;
    if (write && answerLost(res.status, data)) throw new FsmTimeoutError(true, "connection");
    if (!res.ok) throw toFsmError(res.status, text, data);
    return data as T;
  });
}

/**
 * A gateway error (502/503/504) on a write: the proxy or a gateway in front of FSM lost the answer,
 * so FSM may have saved the write. Not when the proxy itself stopped before sending (no token or no
 * configuration: codes AUTH and CONFIG), then nothing reached FSM.
 */
function answerLost(status: number, data: unknown): boolean {
  if (status !== 502 && status !== 503 && status !== 504) return false;
  const code = data && typeof data === "object" ? (data as Record<string, unknown>).code : undefined;
  return code !== "AUTH" && code !== "CONFIG";
}

/** FSM's own message from an error response (Data/Query API: `message`/`error`, proxy: `error`). */
function toFsmError(status: number, text: string, data: unknown): FsmError {
  const message =
    (data && typeof data === "object" && ("message" in data || "error" in data)
      ? String((data as Record<string, unknown>).message ?? (data as Record<string, unknown>).error)
      : text) || `FSM request failed (${status})`;
  return new FsmError(message, status, data);
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

/** Downloads an attachment's binary through the proxy. Errors carry FSM's own message, like every other call. */
export async function fsmAttachmentContent(attachmentId: string): Promise<Blob> {
  return fetchWithTimeout(attachmentContentUrl(attachmentId), {}, false, async (res) => {
    if (!res.ok) {
      const text = await res.text();
      throw toFsmError(res.status, text, text ? safeJson(text) : null);
    }
    return res.blob();
  });
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
