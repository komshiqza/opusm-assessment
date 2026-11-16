// npm run check:fsm: verifies .env.local and the FSM client without starting Next.js.
const env = (k) => process.env[k]?.trim();

const missing = ["FSM_AUTH_URL", "FSM_CLIENT_ID", "FSM_CLIENT_SECRET", "FSM_ACCOUNT_ID", "FSM_COMPANY_ID"].filter((k) => !env(k));
if (missing.length) {
  console.error(`✗ Missing in .env.local: ${missing.join(", ")}`);
  process.exit(1);
}
if (!/^[a-z0-9-]{3,20}$/.test((env("NEXT_PUBLIC_CANDIDATE_ID") ?? "").toLowerCase())) {
  console.warn("! NEXT_PUBLIC_CANDIDATE_ID is missing or invalid (3-20 chars, a-z 0-9 -)");
}

const tokenRes = await fetch(env("FSM_AUTH_URL"), {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env("FSM_CLIENT_ID"),
    client_secret: env("FSM_CLIENT_SECRET"),
  }),
});
if (!tokenRes.ok) {
  console.error(`✗ Token request failed: ${tokenRes.status} ${await tokenRes.text()}`);
  process.exit(1);
}
const token = await tokenRes.json();
const company = token.companies?.find((c) => String(c.id) === env("FSM_COMPANY_ID"));
if (!company) {
  console.error(`✗ Client has no access to company ${env("FSM_COMPANY_ID")}`);
  process.exit(1);
}
console.log(`✓ Token OK: cluster ${token.cluster_url}, company "${company.name}"`);

const q = await fetch(`${token.cluster_url}/api/query/v1?dtos=Person.24;Tag.10;Skill.11`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token.access_token}`,
    "X-Account-ID": env("FSM_ACCOUNT_ID"),
    "X-Company-ID": env("FSM_COMPANY_ID"),
    "X-Client-ID": "opusm-skill-assessment",
    "X-Client-Version": "1.0",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: "SELECT COUNT(p.id) AS persons FROM Person p" }),
});
const data = await q.json();
if (!q.ok) {
  console.error(`✗ Query failed: ${JSON.stringify(data)}`);
  process.exit(1);
}
console.log(`✓ Query OK: ${data.data?.[0]?.persons} persons in the company`);
