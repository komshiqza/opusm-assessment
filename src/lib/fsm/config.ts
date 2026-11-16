import "server-only";

export interface FsmServerConfig {
  authUrl: string;
  clientId: string;
  clientSecret: string;
  accountId: string;
  companyId: string;
}

export class FsmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FsmConfigError";
  }
}

function required(key: string): string {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new FsmConfigError(`${key} is missing. Copy .env.example to .env.local and restart \`npm run dev\`.`);
  }
  return value;
}

/** Reads the FSM client from `.env.local`. Server-only: the secret must never reach the browser. */
export function getFsmConfig(): FsmServerConfig {
  return {
    authUrl: required("FSM_AUTH_URL"),
    clientId: required("FSM_CLIENT_ID"),
    clientSecret: required("FSM_CLIENT_SECRET"),
    accountId: required("FSM_ACCOUNT_ID"),
    companyId: required("FSM_COMPANY_ID"),
  };
}
