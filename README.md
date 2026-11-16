# opusm Developer Assessment: Skill Management on SAP FSM

Welcome, and thanks for applying at **opusm**!

In this assessment you build a small **skill management app** on top of **SAP Field Service Management (FSM)**: a skill matrix, skill assignments with validity periods, and certificate files per assignment.

Authentication against SAP FSM is **already built**, so you can focus on the app itself.

| | |
|---|---|
| **What to build** | → [ASSIGNMENT.md](ASSIGNMENT.md) |
| **FSM data model and API cheat sheet** | → [docs/FSM_GUIDE.md](docs/FSM_GUIDE.md) |
| **Official SAP FSM documentation** | → [SAP Help Portal: SAP Field Service Management](https://help.sap.com/docs/SAP_FIELD_SERVICE_MANAGEMENT?locale=en-US) |
| **Deadline** | **Saturday, 21.11.2026, 23:59 (CET)**. The FSM credentials stop working after that. |
| **Expected effort** | about 6-8 hours for the required scope. Everything marked *optional* is optional. |

---

## Quick start

Requirements: Node.js 22 or newer, npm.

```bash
# 1. Create your own copy: click "Use this template" on GitHub (public repo, your account), then clone it.
npm install

# 2. Environment
cp .env.example .env.local
#    Set NEXT_PUBLIC_CANDIDATE_ID to your GitHub username (lowercase). Leave the FSM values as they are.

# 3. Check the FSM connection (no browser needed)
npm run check:fsm

# 4. Start
npm run dev          # http://localhost:3000
```

The starter page shows a green "Connected to FSM company …" message and a list of persons. If you see that, everything works.

## What is pre-built

```
browser (your React app)
   │  fetch("/api/fsm/...")                       ← src/lib/fsm/client.ts (fsmQuery, fsmCreate, skillSearch, ...)
   ▼
Next.js route /api/fsm/[...path]                 ← src/app/api/fsm/[...path]/route.ts
   │  + OAuth token (client_credentials, cached, auto-refresh)
   │  + X-Account-ID / X-Company-ID / X-Client-* headers
   ▼
SAP FSM  https://eu.fsm.cloud.sap
   /api/query/v1                    Query API (CoreSQL)       ← /api/fsm/query/v1
   /api/data/v4/...                 Data API                  ← /api/fsm/data/v4/...
   /cloud-skill-service/api/...     Skill Service API         ← /api/fsm/skill/v1|v2/...
```

| File | Purpose |
|---|---|
| `src/lib/fsm/token.ts` | Gets and caches the OAuth token, checks it belongs to the configured account and company. Server-only. |
| `src/app/api/fsm/[...path]/route.ts` | Proxy to FSM (Query, Data and Skill Service API). **Writes are limited to Tags, Skills, Attachments, Scales and Proficiencies.** |
| `src/app/api/health/route.ts` | `GET /api/health`: connection check. |
| `src/lib/fsm/client.ts` | Small browser client. Query/Data API: `fsmQuery`, `fsmGet`, `fsmCreate`, `fsmUpdate`, `fsmDelete`, `attachmentContentUrl`, `fileToBase64`. Skill Service: `skillSearch`, `skillApi`, `assertBulkOk`. |
| `src/lib/fsm/dtos.ts` | DTO versions (`Person.24`, `Tag.10`, `Skill.11`, `Attachment.19`). |
| `src/lib/fsm/types.ts` | Minimal TypeScript types for these entities and the Skill Service. |
| `src/lib/candidate.ts` | Your namespace helpers (`toScopedName`, `fromScopedName`, `isOwnName`). |
| `src/components/StarterPage.tsx` | Setup check page. Replace it. |

You may change, restructure or extend any of this, including the client and the types. Please keep two things:
1. The **OAuth secret and token stay on the server**: no `NEXT_PUBLIC_` secret, no token in the browser.
2. The **write restrictions** in the proxy stay in place.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **UI5 Web Components for React** (`@ui5/webcomponents-react`, SAP Fiori Horizon theme). **Required** for the UI. Docs: <https://ui5.github.io/webcomponents-react/>
- SAP FSM documentation: <https://help.sap.com/docs/SAP_FIELD_SERVICE_MANAGEMENT?locale=en-US>
- Add any other libraries you like (data fetching, state, validation, testing, …). Explain your choices in your README.

## Important: the FSM company is shared

All candidates work in **the same FSM demo company** with the same credentials. The data is fictitious demo data. Please read **"Rules for the shared company"** in [ASSIGNMENT.md](ASSIGNMENT.md) before you write anything to FSM.

The credentials in `.env.example` are intentionally public for this assessment and are revoked after the deadline. Don't use them for anything else.

## Not part of this assessment

- Embedding into the SAP FSM Shell or the FSM mobile app (web container). The app runs standalone on `localhost`.
- A configuration page or multi-tenant setup. All configuration comes from `.env.local`.
- User login. The app acts as an administrator through the OAuth client.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Dev server on http://localhost:3000 |
| `npm run build` / `npm start` | Production build / run |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check:fsm` | Verifies `.env.local` and the FSM connection |

## Questions?

If something is blocking you (credentials not working, an FSM error you can't get past), reply to the message in which you received this assessment. Questions about *how* to solve something are part of the assessment: make a reasonable assumption and document it.

Good luck. We're looking forward to your solution!
