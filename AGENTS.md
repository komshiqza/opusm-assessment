# Notes for AI coding assistants

- Task: [ASSIGNMENT.md](ASSIGNMENT.md). FSM data model and the three APIs (Query, Data, Skill Service): [docs/FSM_GUIDE.md](docs/FSM_GUIDE.md). Official docs: https://help.sap.com/docs/SAP_FIELD_SERVICE_MANAGEMENT?locale=en-US
- Stack: Next.js 16 App Router, React 19, TypeScript, UI5 Web Components for React 2.x (required for the UI).
- All FSM access goes through `/api/fsm/...` (`src/lib/fsm/client.ts`). Never expose `FSM_CLIENT_SECRET` or the token to the browser, and never call FSM directly from client code.
- The FSM company is shared. Only create, update or delete Tags and Scales named `<NEXT_PUBLIC_CANDIDATE_ID>::…`, Skills that reference those Tags, and Attachments on those Skills (`src/lib/candidate.ts`). Persons and all other data are read-only.
- Proficiency levels come from the Skill Service (`skillSearch`, `skillApi`); `Skill.11` in the Data API has no proficiency field.
- Don't change the write allowlist in `src/app/api/fsm/[...path]/route.ts`.
