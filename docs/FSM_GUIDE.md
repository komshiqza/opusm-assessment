# SAP FSM Guide for this assessment

Everything in this guide was checked against the assessment company. For anything else, see the official SAP documentation:

- **SAP Field Service Management on the SAP Help Portal**: <https://help.sap.com/docs/SAP_FIELD_SERVICE_MANAGEMENT?locale=en-US>
  Look for the *Data API (v4)*, *Query API*, *Data Model* and *Skill Service* sections.

## 1. Data model

```
                                             ┌──────────────────┐ 1    n ┌──────────────────┐
                                             │ Scale            │────────│ Proficiency      │
                                             │ (Skill Service)  │        │ level 1, 2, 3 …  │
                                             └────────┬─────────┘        └────────┬─────────┘
                                                      │ scaleId                   │ proficiencyId
┌──────────────┐ 1      n ┌───────────────────┐ n   1 ┌┴─────────────┐            │
│ Person       │──────────│ Skill             │───────│ Tag          │            │
│ (read-only)  │  person  │ = assignment      │  tag  │ = skill def. │            │
└──────────────┘          │ startDate/endDate │       └──────────────┘            │
                          │ proficiency ◄─────┼───────────────────────────────────┘
                          └─────────┬─────────┘
                                    │ 1   object = { objectId: <skill id>, objectType: "SKILL" }
                                    │ n
                          ┌─────────┴─────────┐
                          │ Attachment        │  = certificate file
                          └───────────────────┘
```

A **Tag** can be linked to a **Scale** (e.g. *Basic / Advanced / Expert*). Each **Skill** of that Tag can then carry one **Proficiency** of the scale. Scales and proficiencies exist **only in the Skill Service API**, not in the Data API.

## 2. Three APIs (all through the proxy)

| | **Query API** | **Data API** | **Skill Service API** |
|---|---|---|---|
| Proxy path | `POST /api/fsm/query/v1` | `/api/fsm/data/v4/{Entity}` | `/api/fsm/skill/v1/...`, `/api/fsm/skill/v2/...` |
| FSM path | `/api/query/v1` | `/api/data/v4/...` | `/cloud-skill-service/api/...` |
| Good for | reading lists, joins, filters across entities (Person, Tag, Skill, Attachment) | Attachments (upload, content download, delete); simple CRUD on Tag/Skill | scales, proficiencies, tags with scale, skills **with proficiency** |
| Client helper | `fsmQuery` | `fsmGet`, `fsmCreate`, `fsmUpdate`, `fsmDelete`, `attachmentContentUrl` | `skillSearch`, `skillApi`, `assertBulkOk` |
| Paging | 1-based `page`, max 1000 | 0-based `page`, max 1000 | 0-based `page`, max `size` 1000 |

**The same Skill has the same `id` in all three APIs.** A Skill created through the Skill Service can get attachments through the Data API.

Choosing the API for each task is part of the assessment. Explain your choice in your README.

## 3. Skill Service API

OpenAPI title "FSM Skills" (`cloud-skill-service`), versions `v1` and `v2`. Tested endpoints:

| Purpose | Call |
|---|---|
| Search tags | `POST skill/v1/tags/search` |
| Search skills | `POST skill/v1/skills/search` |
| Search scales | `POST skill/v1/scales/search` |
| Proficiencies of a scale | `POST skill/v1/scales/{scaleId}/proficiencies/search` |
| Create scale with proficiencies | `POST skill/v1/scales` → returns the new scale **id as a string** |
| Create / update tags (bulk) | `POST skill/v2/tags` with `[{ name, description?, scaleId? }]` |
| Create / update skills (bulk) | `POST skill/v2/skills` with `[{ tagId, technician, proficiencyId?, startDate?, endDate? }]` |
| Update one skill | `PATCH skill/v1/tags/{tagId}/skills/{skillId}` with e.g. `{ proficiencyId, endDate }` |
| Delete skills / tags (bulk) | `DELETE skill/v2/skills`, `DELETE skill/v2/tags` with `[{ id }]` |
| Delete a scale | `DELETE skill/v2/scales` with `{ id }` |

### Search requests

```json
{
  "filter": [{ "field": "tag.name", "operator": "like", "value": "jdoe::%" }],
  "page": 0,
  "size": 1000,
  "sort": [{ "property": "lastChangedDate", "direction": "DESC" }]
}
```

Response: `{ content: [...], last: true, totalElements: 3, ... }`. `skillSearch()` loads all pages for you.

Filter notes (tested):
- Operators `=`, `like` (with `%` wildcard) and `contains` work. `startsWith` does **not** exist (400).
- On **skills**, filter the tag with **`tag.id`** or **`tag.name`**, not `tagId` (400: *Could not resolve attribute 'tagId'*). `technicianId` works.
- On **tags** and **scales**, `name` works.

### Bulk responses (v2)

Bulk endpoints answer **HTTP 207 Multi-Status**, even if a single item failed:

```json
{ "hasErrors": false, "results": [ { "status": 201, "resource": { "id": "…", … } } ] }
```

Always check `hasErrors` and the per-item `status`. `assertBulkOk()` does that and returns the resources.

### Example: scale → tag → skill with level

```ts
import { skillApi, skillSearch, assertBulkOk } from "@/lib/fsm/client";
import { NAME_PREFIX, toScopedName } from "@/lib/candidate";
import type { SkillServiceProficiency, SkillServiceSkill, SkillServiceTag } from "@/lib/fsm/types";

// 1. Scale with three levels (level 1, 2, 3 in this order)
const scaleId = await skillApi<string>("v1/scales", {
  method: "POST",
  body: {
    name: toScopedName("Levels"),
    proficiencies: [{ name: "Basic", isDefault: true }, { name: "Advanced" }, { name: "Expert" }],
  },
});
const levels = await skillSearch<SkillServiceProficiency>(`v1/scales/${scaleId}/proficiencies`);

// 2. Tag that uses the scale
const [tag] = assertBulkOk<SkillServiceTag>(
  await skillApi("v2/tags", { method: "POST", body: [{ name: toScopedName("Hydraulics"), scaleId }] }),
);

// 3. Assign to a person with a level and validity
const [skill] = assertBulkOk<SkillServiceSkill>(
  await skillApi("v2/skills", {
    method: "POST",
    body: [{ tagId: tag.id, technician: personId, proficiencyId: levels[1].id, startDate: "2026-01-01", endDate: "2027-12-31" }],
  }),
);

// 4. Change level or validity later
await skillApi(`v1/tags/${tag.id}/skills/${skill.id}`, { method: "PATCH", body: { proficiencyId: levels[2].id } });

// 5. All your assignments incl. level, in one call
const mine = await skillSearch<SkillServiceSkill>("v1/skills", [{ field: "tag.name", operator: "like", value: `${NAME_PREFIX}%` }]);
```

### Skill Service gotchas
- **Open end date**: the Skill Service returns `endDate: "9999-12-31"` (and `startTime 00:00:00` / `endTime 23:59:59`) where the Data API returns `null`. Treat `9999-12-31` as "no end date".
- `validityType`: observed `PE` for open-ended skills and `LF` for skills with a date range. FSM sets it.
- A tag created without a description comes back with `description: " "` (one space).
- Not available in this assessment (blocked by the proxy): groups, requirements, `composite-bulk`, and the `removeMissing*` query flags. They would affect other candidates' data.

## 4. Data API and Query API entities

### Person (`Person.24`): read-only
| Field | Type | Notes |
|---|---|---|
| `id` | string | Skill Service calls this the `technician` / `technicianId` |
| `firstName`, `lastName` | string \| null | a few technical persons have no name |
| `emailAddress`, `jobTitle` | string \| null | |
| `type` | string | e.g. `EMPLOYEE`, `ERPUSER` |
| `inactive` | boolean | show active persons only |

### Tag (`Tag.10`): the skill definition
| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `name` | string, **required**, 1-512 | **must** be `<CANDIDATE_ID>::<display name>` |
| `description` | string \| null | |

The `scaleId` of a tag is only visible through the Skill Service.

### Skill (`Skill.11`): a tag assigned to a person
| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `person` | string (Person id), **required** | |
| `tag` | string (Tag id), **required** | |
| `startDate` | `"YYYY-MM-DD"` \| null | valid from |
| `endDate` | `"YYYY-MM-DD"` \| null | valid to |
| `startTime`, `endTime`, `days`, `validityType` | – | not needed here |

The **proficiency is not part of `Skill.11`**. Read and write it through the Skill Service.

### Attachment (`Attachment.19`): certificate file
| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `fileName` | string, required | e.g. `first-aid-2026.pdf` |
| `title`, `description` | string \| null | |
| `type` | string | **upper-case extension**: `PDF`, `PNG`, `JPEG` (use `JPEG` for `.jpg`) |
| `fileContent` | base64 string | **write-only**: send it on create, it comes back as `null` |
| `object` | `{ objectId, objectType }` | `objectType: "SKILL"`, `objectId: <skill id>` |
| `createDateTime` | ISO date-time | set by FSM |

The binary is fetched separately: `GET data/v4/Attachment/{id}/content` (see `attachmentContentUrl()`).

## 5. CoreSQL examples (Query API)

CoreSQL resembles SQL, but **field names are case-sensitive** (`CA-118: There is no such field …`) and string literals use single quotes.

```sql
-- Active persons
SELECT p.id, p.firstName, p.lastName, p.jobTitle
FROM Person p
WHERE p.inactive = false
ORDER BY p.lastName

-- Your tags (replace jdoe with your CANDIDATE_ID)
SELECT t.id, t.name, t.description
FROM Tag t
WHERE t.name LIKE 'jdoe::%'
ORDER BY t.name

-- Your assignments with the tag name (no proficiency here, see section 3)
SELECT s.id, s.person, s.tag, s.startDate, s.endDate, t.name
FROM Skill s
JOIN Tag t ON t.id = s.tag
WHERE t.name LIKE 'jdoe::%'

-- Certificates of several assignments
SELECT a.id, a.fileName, a.type, a.createDateTime, a.object.objectId
FROM Attachment a
WHERE a.object.objectType = 'SKILL' AND a.object.objectId IN ('<skillId1>', '<skillId2>')
```

```ts
import { fsmQuery } from "@/lib/fsm/client";
import type { FsmPerson } from "@/lib/fsm/types";

const persons = await fsmQuery<{ p: FsmPerson }>("SELECT p FROM Person p WHERE p.inactive = false", ["Person"]);
```

Long `IN (...)` lists: split them into chunks (e.g. 100 ids per query). Ids must be real FSM ids (32 hex chars). Anything else fails with `CA-137: Invalid reference identifier format`. Skip the query if the list is empty.

## 6. Attachments (Data API)

```tsx
import { fsmCreate, fsmDelete, fileToBase64, attachmentContentUrl } from "@/lib/fsm/client";

await fsmCreate<FsmAttachment>("Attachment", {
  fileName: file.name,
  title: file.name,
  type: "PDF",
  fileContent: await fileToBase64(file),
  object: { objectId: skillId, objectType: "SKILL" },
});

<a href={attachmentContentUrl(attachment.id)} target="_blank">{attachment.fileName}</a>

await fsmDelete("Attachment", attachmentId);
```

## 7. General gotchas

- **Dates**: skill dates are plain dates (`YYYY-MM-DD`), not date-times. Watch time zones when converting from `Date`.
- **Data API updates and deletes** need `forceUpdate=true` / `forceDelete=true`. The helpers add them. FSM rejects `dtos=` on DELETE.
- **Attachment content** can't be changed. Delete the attachment and upload a new one.
- **Base64 grows files by about 33%**. Check the 5 MB limit on the original file before encoding.
- **Errors**: the Data and Query APIs return `{ error: "CA-…", message: "…" }`, the Skill Service returns `{ status: "BAD_REQUEST", message: "…" }`. `FsmError.message` holds the readable part.
- **Proxy errors** (`PATH_NOT_ALLOWED`, `WRITE_NOT_ALLOWED`, `AUTH`, `CONFIG`) come from `/api/fsm` itself, not from FSM.
- **Shared data**: you will see tags, skills and scales of other candidates and the demo data. Always filter by your prefix.
