/** GET /api/health: verifies `.env.local`, the OAuth client and one FSM query. */
import { NextResponse } from "next/server";
import { DTO } from "@/lib/fsm/dtos";
import { fsmHeaders } from "@/lib/fsm/headers";
import { FsmAuthError, FsmConfigError, getFsmSession } from "@/lib/fsm/token";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getFsmSession();
    const res = await fetch(`${session.clusterUrl}/api/query/v1?dtos=${DTO.Person}`, {
      method: "POST",
      headers: {
        ...fsmHeaders(session.accountId, session.companyId),
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "SELECT COUNT(p.id) AS persons FROM Person p" }),
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: data?.message ?? `FSM query failed (${res.status})` }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      cluster: session.clusterUrl,
      accountId: session.accountId,
      companyId: session.companyId,
      companyName: session.companyName,
      persons: data?.data?.[0]?.persons ?? null,
      tokenExpiresAt: new Date(session.expiresAt).toISOString(),
    });
  } catch (e) {
    const status = e instanceof FsmAuthError ? e.status : 500;
    const message = e instanceof FsmConfigError || e instanceof FsmAuthError || e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
