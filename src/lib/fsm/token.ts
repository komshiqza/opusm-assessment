import "server-only";
import { FsmConfigError, getFsmConfig, type FsmServerConfig } from "./config";

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  cluster_url: string;
  account_id: number | string;
  companies?: { id: number; name: string }[];
}

export interface FsmSession {
  token: string;
  /** e.g. https://eu.fsm.cloud.sap (without /api) */
  clusterUrl: string;
  accountId: string;
  companyId: string;
  companyName: string;
  expiresAt: number;
}

export class FsmAuthError extends Error {
  constructor(
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "FsmAuthError";
  }
}

/** Refresh this long before the token actually expires. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

let cached: FsmSession | null = null;
let inflight: Promise<FsmSession> | null = null;

async function requestToken(cfg: FsmServerConfig): Promise<FsmSession> {
  const res = await fetch(cfg.authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new FsmAuthError(`FSM token request failed (${res.status}): ${text.slice(0, 300)}`, res.status === 401 ? 401 : 502);
  }

  const data = JSON.parse(text) as TokenResponse;
  if (!data.access_token || !data.cluster_url) {
    throw new FsmAuthError("FSM token response has no access_token / cluster_url");
  }

  // Scope check: the client must belong to the configured account and company.
  if (String(data.account_id) !== cfg.accountId) {
    throw new FsmAuthError(`Token is for account ${data.account_id}, but FSM_ACCOUNT_ID is ${cfg.accountId}`, 403);
  }
  const company = data.companies?.find((c) => String(c.id) === cfg.companyId);
  if (!company) {
    throw new FsmAuthError(`OAuth client has no access to company ${cfg.companyId}`, 403);
  }

  const lifetimeMs = (data.expires_in ?? 3600) * 1000;
  return {
    token: data.access_token,
    clusterUrl: data.cluster_url.replace(/\/$/, ""),
    accountId: cfg.accountId,
    companyId: cfg.companyId,
    companyName: company.name,
    expiresAt: Date.now() + lifetimeMs,
  };
}

/**
 * Cached client_credentials session (one per server process). Concurrent callers share one
 * token request. Pass `forceRefresh` after a 401 from FSM.
 */
export async function getFsmSession(forceRefresh = false): Promise<FsmSession> {
  if (!forceRefresh && cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return cached;
  }
  if (!inflight) {
    inflight = requestToken(getFsmConfig())
      .then((session) => {
        cached = session;
        return session;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export { FsmConfigError };
