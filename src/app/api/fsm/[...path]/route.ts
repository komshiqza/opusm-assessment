/**
 * Pre-built FSM proxy. You should not need to change this file.
 *
 *   /api/fsm/data/v4/...     ──►  <cluster>/api/data/v4/...                 (Data API)
 *   /api/fsm/query/v1        ──►  <cluster>/api/query/v1                    (Query API)
 *   /api/fsm/skill/v1|v2/... ──►  <cluster>/cloud-skill-service/api/v1|v2/... (Skill Service API)
 *
 *   + Authorization: Bearer <token>, X-Account-ID / X-Company-ID / X-Client-*
 *
 * - The OAuth secret and the token stay on the server.
 * - Writes are limited to what this assessment needs, so a bug cannot damage the rest of the
 *   shared demo company (see WRITE RULES below).
 * - On a 401 from FSM the token is refreshed once and the call retried.
 */
import { NextResponse } from "next/server";
import { fsmHeaders } from "@/lib/fsm/headers";
import { FsmAuthError, FsmConfigError, getFsmSession } from "@/lib/fsm/token";
import { checkWriteOwnership, fsmOwnershipReader } from "@/lib/fsm/serverOwnership";

export const dynamic = "force-dynamic";

// --- WRITE RULES ---------------------------------------------------------------
/** Data API entities that may be created / changed / deleted. */
const DATA_WRITABLE = new Set(["Tag", "Skill", "Attachment"]);
/** Skill Service resources that may be changed (any `.../search` POST is a read and always allowed). */
const SKILL_WRITABLE = new Set(["tags", "skills", "scales", "proficiencies"]);
/** Skill Service query flags that would delete data of other candidates. */
const FORBIDDEN_PARAMS = ["removeMissingSkills", "removeMissingTags", "removeMissingScales", "removeMissingProficiencies"];

/** Response headers worth passing through to the browser. */
const PASS_THROUGH_HEADERS = ["content-type", "content-disposition", "content-length"];

type Params = { params: Promise<{ path: string[] }> };

function error(status: number, message: string, code: string) {
  return NextResponse.json({ error: message, code }, { status });
}

/** Maps the proxy path to the FSM URL path, or returns an error message. */
function resolveTarget(segments: string[], method: string, search: URLSearchParams): { path: string } | { denied: string; code: string } {
  const [api, version] = segments;
  const rest = segments.map(encodeURIComponent).join("/");
  const isWrite = method !== "GET" && method !== "HEAD";

  // Data API
  if (api === "data" && version === "v4") {
    const entity = segments[2] ?? "";
    if (isWrite && !DATA_WRITABLE.has(entity)) {
      return { denied: `${method} on ${entity} is not allowed in this assessment (writable: ${[...DATA_WRITABLE].join(", ")}).`, code: "WRITE_NOT_ALLOWED" };
    }
    return { path: `/api/${rest}` };
  }

  // Query API (POST is a read)
  if (api === "query" && version === "v1" && segments.length === 2) {
    return { path: `/api/${rest}` };
  }

  // Skill Service API
  if (api === "skill" && (version === "v1" || version === "v2")) {
    const resourcePath = segments.slice(2);
    const isSearch = method === "POST" && resourcePath[resourcePath.length - 1] === "search";
    if (isWrite && !isSearch) {
      const allowed =
        SKILL_WRITABLE.has(resourcePath[0] ?? "") && !resourcePath.includes("requirements");
      if (!allowed) {
        return {
          denied: `${method} on skill/${version}/${resourcePath.join("/")} is not allowed in this assessment (writable: ${[...SKILL_WRITABLE].join(", ")}; no groups, requirements or composite-bulk).`,
          code: "WRITE_NOT_ALLOWED",
        };
      }
      const flag = FORBIDDEN_PARAMS.find((p) => search.has(p));
      if (flag) return { denied: `Query parameter ${flag} is not allowed in the shared company.`, code: "WRITE_NOT_ALLOWED" };
    }
    return { path: `/cloud-skill-service/api/${segments.slice(1).map(encodeURIComponent).join("/")}` };
  }

  return { denied: `Path "${segments.join("/")}" is not available through this proxy (allowed: data/v4/*, query/v1, skill/v1|v2/*).`, code: "PATH_NOT_ALLOWED" };
}

async function handle(req: Request, { params }: Params): Promise<Response> {
  const { path } = await params;
  const method = req.method.toUpperCase();
  const url = new URL(req.url);

  const target = resolveTarget(path, method, url.searchParams);
  if ("denied" in target) return error(403, target.denied, target.code);

  // Added for the assessment: per-record ownership check on the server (only own Tags/Scales,
  // their Skills and those Skills' Attachments; any other write is refused). The allowlist above is unchanged.
  const notOwn = await checkWriteOwnership(path, method, () => req.clone().json(), fsmOwnershipReader());
  if (notOwn) return error(403, notOwn, "NOT_OWN");

  const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();
  const contentType = req.headers.get("content-type") ?? "application/json";

  const send = async (forceRefresh: boolean) => {
    const session = await getFsmSession(forceRefresh);
    return fetch(`${session.clusterUrl}${target.path}${url.search}`, {
      method,
      headers: {
        ...fsmHeaders(session.accountId, session.companyId),
        Authorization: `Bearer ${session.token}`,
        Accept: req.headers.get("accept") ?? "application/json",
        ...(body ? { "Content-Type": contentType } : {}),
      },
      body,
      cache: "no-store",
    });
  };

  try {
    let upstream = await send(false);
    if (upstream.status === 401) {
      upstream = await send(true);
    }

    const headers = new Headers();
    for (const name of PASS_THROUGH_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (e) {
    if (e instanceof FsmConfigError) return error(500, e.message, "CONFIG");
    if (e instanceof FsmAuthError) return error(e.status, e.message, "AUTH");
    console.error("[api/fsm] proxy error", e);
    return error(502, e instanceof Error ? e.message : "FSM request failed", "UPSTREAM");
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;
