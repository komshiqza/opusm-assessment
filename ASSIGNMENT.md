# Assignment: Skill Management for Field Service Technicians

## Business context

A field service company employs technicians with very different qualifications: welding, electrical switching permits, gas engine certifications, first aid, working at heights, and so on. Many of these qualifications are **certified** and **expire**. If an expired certification goes unnoticed, the company may send a technician to a job they are not allowed to do.

The service manager needs one place to answer:

> **Which person has which skill, backed by which certificate, valid until when?**

SAP FSM already has the building blocks: **Tags** (skill definitions), **Skills** (a tag assigned to a person, with an optional validity period), **proficiency scales** (levels) and **Attachments** (files linked to an object). Your job is to build a usable app on top of them.

## Required scope

Build a web app (Next.js + UI5 Web Components for React, see [README.md](README.md)) for a **service manager**. All data must be read from and written to **SAP FSM** through the provided proxy. No separate database for skill data.

### 1. Skill catalogue
- List your skills (FSM `Tag`s in your namespace, see the rules below), showing the display name without the prefix.
- Create, rename and delete a skill (description optional).
- Deleting a skill that is still assigned to persons needs a sensible behaviour. Decide what that is and document it.

### 2. Skill matrix
- A matrix with **persons as rows** and **your skills as columns**.
- Each cell shows the assignment status at a glance:
  - not assigned
  - valid (no end date, or end date further away than 30 days)
  - expiring soon (end date within the next 30 days)
  - expired (end date in the past)
- Each cell shows whether at least one certificate is attached.
- Search or filter at least by person name and by skill.
- Persons are **read-only** (they are shared demo data). Show active persons only.

### 3. Assign skills
- From the matrix (e.g. by clicking a cell), assign a skill to a person with **valid from** and **valid to** (both optional).
- Edit the validity period of an existing assignment.
- Remove an assignment.
- Validate input (e.g. "valid to" must not be before "valid from").

### 4. Certificates
- Upload one or more files to an assignment (FSM `Attachment` linked to the `Skill`). At least **PDF, JPG and PNG**, max. **5 MB** per file.
- List an assignment's certificates (file name, upload date) and open or download them.
- Delete a certificate.

### 5. Proficiency level
The business also wants a **proficiency level** per assignment (e.g. *Basic / Advanced / Expert*).

Use FSM's standard mechanism for this: **proficiency scales** of the **Skill Service API** (see [docs/FSM_GUIDE.md](docs/FSM_GUIDE.md), section 3).
- Create (at least) one scale in your namespace and link your skills (Tags) to it.
- Show the level in the matrix and let the manager set or change it when assigning a skill.
- FSM now offers several APIs (Query, Data, Skill Service) that overlap. Decide which one you use for which task and explain why in your README.

### 6. Quality
- Loading, empty and error states. FSM errors must be visible to the user, not just logged to the console.
- A clean structure that another developer can continue with.
- `npm run build`, `npm run lint` and `npm run typecheck` pass.

## Optional (only if you have time, in no particular order)

- **Expiry overview**: a list or dashboard of everything that expires in the next N days, sorted by date.
- **Person detail view**: all skills and certificates of one person.
- **Technician self-service view**: a read-only "my skills" view for one selected person.
- **Bulk actions**: assign one skill to several persons at once.
- **Export**: the matrix as CSV or Excel.
- **Certificate preview**: inline preview for PDFs and images.
- **Tests**: unit tests for your status / validity logic, or component tests.
- **i18n**: English and German.
- **Responsive layout**: usable on a tablet.
- **Hosting**: deploy it (e.g. Vercel) and share the URL. The FSM credentials go into the hosting provider's environment variables, not into client code.

## Rules for the shared company

All candidates share one FSM demo company and one OAuth client. Please follow these rules. Breaking them on purpose is grounds for disqualification.

1. **Namespace.** Set `NEXT_PUBLIC_CANDIDATE_ID` (your GitHub username, lowercase) in `.env.local`. **Every Tag and every Scale you create must be named `<CANDIDATE_ID>::<display name>`**, e.g. `jdoe::Hydraulics`. Helpers: `src/lib/candidate.ts`.
2. **Only change what is yours.** Create, update and delete only:
   - Tags and Scales (incl. their proficiencies) in your namespace,
   - Skills that reference one of your Tags,
   - Attachments linked to one of those Skills.
3. **Everything else is read-only**: persons, the existing demo tags (without a `::` prefix) and their skills, and anything created by other candidates. You will see other candidates' data. Filter it out.
4. The proxy only lets you write Tags, Skills, Attachments, Scales and Proficiencies, and blocks groups, requirements, composite-bulk and the `removeMissing*` flags. Don't work around it.
5. No load tests, no bulk imports beyond a few dozen records, and no fake personal data in uploaded files. Use dummy PDFs or images.

## Deliverables

By **21.11.2026, 23:59 CET**, send us:

1. **A link to your public GitHub repository** (created via "Use this template").
2. **Your README** (replace or extend ours) with:
   - how to run it (if anything differs from our quick start),
   - your **design decisions** and **trade-offs**, especially which API you use for what, the delete behaviour in 1. and anything you would do differently with more time,
   - known limitations and open issues,
   - **use of AI tools**: AI coding assistants are allowed. Briefly describe which ones you used and for what. We will talk about your code in the follow-up interview, so make sure you understand everything you submit.
3. *(Optional)* a URL of a hosted version.

Please reply to the message in which you received this assessment.

## How we evaluate

| Area | What we look at |
|---|---|
| **FSM integration** | Correct use of Tag, Skill, Scale/Proficiency and Attachment; a sensible choice between Query, Data and Skill Service API; efficient calls (no N+1 call storms); respecting the shared-company rules |
| **Functionality** | Required scope works end to end; edge cases (dates, empty data, failed uploads) |
| **UX / UI5** | Fiori-like, clear for a service manager; the matrix is readable with 25+ persons |
| **Code quality** | Structure, typing, separation of FSM access, state handling and UI; readability |
| **Communication** | README: decisions, trade-offs, honesty about limitations |

Optional items are a bonus. A smaller, solid and well-explained solution beats a large, fragile one.
