/**
 * One skill to several persons against a fake FSM: partial failure, skip existing, the limit, and no blind retry.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FSM_TIMEOUT_MS } from "@/lib/fsm/client";
import { bulkAssign, retryBulk, recheckBulk, BULK_LIMIT } from "./bulk";
import { installFakeFsm, fsm, writes, OWN_TAG, SKILL } from "./fakeFsm";

// Node has no FileReader; the base64 encoding itself is not under test here.
vi.mock("@/lib/fsm/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fsm/client")>()),
  fileToBase64: async (file: Blob) => Buffer.from(await file.arrayBuffer()).toString("base64"),
}));

installFakeFsm();

describe("assign one skill to several persons", () => {
  const people = ["A", "B", "C"].map((c) => c.repeat(32));
  const input = { startDate: "2026-11-16", endDate: "2027-11-16", proficiencyId: "LEVEL" };
  /** Persons FSM already lists with the skill (the duplicate check finds them). */
  let alreadyHave: Set<string>;
  /** Persons whose create FSM refuses. */
  let refused: Set<string>;
  /** Persons FSM stores although the create timed out (the answer was lost). */
  let arrives: Set<string>;
  const creates = () => writes().filter((c) => c.path === "skill/v2/skills").map((c) => (c.body as { technician: string }[])[0].technician);

  beforeEach(() => {
    alreadyHave = new Set();
    refused = new Set();
    arrives = new Set();
    fsm.searchAnswer = (path, filter) => {
      if (path === "skill/v1/tags/search") return [{ id: OWN_TAG, name: "komshiqza::Welding" }];
      const person = filter.find((f) => f.field === "technicianId")?.value as string | undefined;
      if (path === "skill/v1/skills/search" && person) {
        return alreadyHave.has(person) || arrives.has(person) ? [{ id: SKILL, tagId: OWN_TAG, tagName: "komshiqza::Welding", technicianId: person }] : [];
      }
      return [];
    };
    fsm.bulkAnswer = (path, method, body) => {
      const person = (body as { technician: string }[] | undefined)?.[0]?.technician;
      if (path === "skill/v2/skills" && method === "POST" && person && refused.has(person)) {
        return { hasErrors: true, results: [{ status: 400, error: { detail: "Simulated FSM refusal" } }] };
      }
      return null;
    };
  });

  it("assigns each person and reports a partial failure per person with FSM's message", async () => {
    refused = new Set([people[1]]);
    const results = await bulkAssign(OWN_TAG, people, input);
    expect(results.map((r) => [r.personId, r.result])).toEqual([
      [people[0], "assigned"],
      [people[1], "failed"],
      [people[2], "assigned"],
    ]);
    expect(results[1].error).toMatch(/Simulated FSM refusal/);
    expect(creates()).toEqual(people);
  });

  it("skips a person who already has the skill, without a write for them", async () => {
    alreadyHave = new Set([people[0]]);
    const results = await bulkAssign(OWN_TAG, people, input);
    expect(results.map((r) => r.result)).toEqual(["skipped", "assigned", "assigned"]);
    expect(creates()).toEqual([people[1], people[2]]);
  });

  it("skips a person whose linked (Employee) record already holds the skill, without a write", async () => {
    const employeeRecord = "E".repeat(32);
    alreadyHave = new Set([employeeRecord]);
    fsm.personRecords = (refId) => [
      { id: refId, refId, type: "ERPUSER", inactive: false },
      { id: employeeRecord, refId, type: "EMPLOYEE", inactive: false },
    ];
    const results = await bulkAssign(OWN_TAG, [people[0]], input);
    expect(results.map((r) => r.result)).toEqual(["skipped"]);
    expect(creates()).toEqual([]);
  });

  it(`refuses more than ${BULK_LIMIT} persons at once, before any write`, async () => {
    const many = Array.from({ length: BULK_LIMIT + 1 }, (_, i) => String(i).padStart(32, "0"));
    await expect(bulkAssign(OWN_TAG, many, input)).rejects.toThrow(/25/);
    expect(writes()).toEqual([]);
  });

  it("retries only the failed persons", async () => {
    refused = new Set([people[1]]);
    const first = await bulkAssign(OWN_TAG, people, input);
    refused = new Set();
    fsm.calls = [];
    const retry = await retryBulk(OWN_TAG, first.filter((r) => r.result === "failed"), input);
    expect(retry.map((r) => [r.personId, r.result])).toEqual([[people[1], "assigned"]]);
    expect(creates()).toEqual([people[1]]);
  });

  it("a timed-out create is checked, never sent again by itself, and a retry checks first", async () => {
    vi.useFakeTimers();
    try {
      fsm.hangingWrite = "skill/v2/skills";
      const pending = bulkAssign(OWN_TAG, [people[0]], input);
      await vi.advanceTimersByTimeAsync(FSM_TIMEOUT_MS);
      const [result] = await pending;
      expect(result).toMatchObject({ result: "failed", checkFirst: true });
      expect(creates()).toEqual([people[0]]);

      // FSM finished the first create after all: the retry finds it and does not create again.
      fsm.hangingWrite = null;
      arrives = new Set([people[0]]);
      fsm.calls = [];
      const [retried] = await retryBulk(OWN_TAG, [result], input);
      expect(retried.result).toBe("assigned");
      expect(creates()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a create whose connection breaks after FSM saved it is checked and reported as assigned (Codex finding)", async () => {
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
      const response = await base(input, init);
      if (String(input).includes("skill/v2/skills") && (init.method ?? "GET").toUpperCase() === "POST") {
        arrives = new Set([people[0]]); // FSM saved it ...
        throw new TypeError("Failed to fetch"); // ... but the answer never reached the browser
      }
      return response;
    });
    const [result] = await bulkAssign(OWN_TAG, [people[0]], input);
    expect(result.result).toBe("assigned");
    expect(creates()).toEqual([people[0]]);
  });

  it.each([502, 503, 504])("a create that ends in %i after FSM saved it (proxy lost the answer) is checked and reported as assigned", async (status) => {
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: string, init: RequestInit = {}) => {
      const response = await base(input, init);
      if (String(input).includes("skill/v2/skills") && (init.method ?? "GET").toUpperCase() === "POST") {
        arrives = new Set([people[0]]); // FSM saved it, but the proxy's connection to FSM broke
        return new Response(JSON.stringify({ error: "socket hang up", code: "UPSTREAM" }), { status });
      }
      return response;
    });
    const [result] = await bulkAssign(OWN_TAG, [people[0]], input);
    expect(result.result).toBe("assigned");
    expect(creates()).toEqual([people[0]]);
  });

  it("a timed-out create whose check fails stays 'not confirmed' and is only checked again", async () => {
    vi.useFakeTimers();
    try {
      fsm.hangingWrite = "skill/v2/skills";
      const base = fsm.searchAnswer;
      let checkFails = false;
      fsm.searchAnswer = (path, filter) => {
        if (checkFails && filter.some((f) => f.field === "technicianId")) throw new Error("simulated outage");
        return base(path, filter);
      };
      const pending = bulkAssign(OWN_TAG, [people[0]], input);
      await vi.advanceTimersByTimeAsync(1);
      checkFails = true;
      await vi.advanceTimersByTimeAsync(FSM_TIMEOUT_MS);
      const [result] = await pending;
      expect(result.result).toBe("unconfirmed");

      checkFails = false;
      fsm.hangingWrite = null;
      fsm.calls = [];
      const [checked] = await recheckBulk(OWN_TAG, [result]);
      expect(checked).toMatchObject({ result: "failed", checkFirst: true });
      expect(creates()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
