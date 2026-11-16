"use client";

/**
 * Starter page: proves that `.env.local`, the proxy and the FSM client work.
 * Replace or delete it. It is not part of the assessment.
 */
import { useEffect, useState } from "react";
import {
  BusyIndicator,
  List,
  ListItemStandard,
  MessageStrip,
  ShellBar,
  Text,
  Title,
} from "@ui5/webcomponents-react";
import { fsmQuery } from "@/lib/fsm/client";
import type { FsmPerson } from "@/lib/fsm/types";
import { CANDIDATE_ID, CANDIDATE_ID_VALID } from "@/lib/candidate";

interface Health {
  ok: boolean;
  error?: string;
  companyName?: string;
  companyId?: string;
  persons?: number;
}

export function StarterPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [persons, setPersons] = useState<FsmPerson[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setHealth({ ok: false, error: String(e) }));

    fsmQuery<{ p: FsmPerson }>(
      "SELECT p.id, p.firstName, p.lastName, p.emailAddress, p.jobTitle FROM Person p WHERE p.inactive = false ORDER BY p.lastName",
      ["Person"],
    )
      .then((rows) => setPersons(rows.map((r) => r.p)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <>
      <ShellBar primaryTitle="Skill Management" secondaryTitle="opusm assessment" />
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "1rem", display: "grid", gap: "1rem" }}>
        <Title level="H3">Setup check</Title>

        {!CANDIDATE_ID_VALID && (
          <MessageStrip design="Critical" hideCloseButton>
            NEXT_PUBLIC_CANDIDATE_ID in .env.local is missing or invalid (3-20 chars, a-z 0-9 -). Set it and restart `npm run dev`.
          </MessageStrip>
        )}
        {CANDIDATE_ID_VALID && (
          <MessageStrip design="Information" hideCloseButton>
            Candidate ID: <b>{CANDIDATE_ID}</b>. Your skills (Tags) must be named &quot;{CANDIDATE_ID}::&lt;name&gt;&quot;.
          </MessageStrip>
        )}

        {!health && <BusyIndicator active />}
        {health?.ok && (
          <MessageStrip design="Positive" hideCloseButton>
            Connected to FSM company &quot;{health.companyName}&quot; ({health.companyId}). {health.persons} persons found.
          </MessageStrip>
        )}
        {health && !health.ok && (
          <MessageStrip design="Negative" hideCloseButton>
            FSM connection failed: {health.error}
          </MessageStrip>
        )}

        <Title level="H4">Persons (loaded in the browser through /api/fsm)</Title>
        {error && (
          <MessageStrip design="Negative" hideCloseButton>
            {error}
          </MessageStrip>
        )}
        {!persons && !error && <BusyIndicator active />}
        {persons && (
          <List>
            {persons.map((p) => (
              <ListItemStandard key={p.id} description={p.jobTitle ?? p.emailAddress ?? undefined}>
                {[p.firstName, p.lastName].filter(Boolean).join(" ") || p.id}
              </ListItemStandard>
            ))}
          </List>
        )}

        <Text>
          Everything works? Read ASSIGNMENT.md and docs/FSM_GUIDE.md, then replace this page with your app.
        </Text>
      </main>
    </>
  );
}
