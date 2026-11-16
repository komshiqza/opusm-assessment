import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FSM_TIMEOUT_MS, FsmTimeoutError, skillApi, skillSearch } from "./client";
import { toUserMessage } from "@/lib/errors";

/** FSM that never answers; the request ends only when the app aborts it. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init: RequestInit = {}) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")));
      }),
  );
}

describe("FSM request timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", hangingFetch());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("ends a read that FSM does not answer, with a clear message", async () => {
    const read = skillSearch("v1/skills");
    const expectation = expect(read).rejects.toBeInstanceOf(FsmTimeoutError);
    await vi.advanceTimersByTimeAsync(FSM_TIMEOUT_MS);
    await expectation;
    const error = await read.catch((e: unknown) => e);
    expect((error as FsmTimeoutError).write).toBe(false);
    expect(toUserMessage(error)).toMatch(/FSM did not answer/);
  });

  it("treats a timed-out write as an unknown result: check before trying again, never a plain failure", async () => {
    const write = skillApi("v2/skills", { method: "POST", body: [{ tagId: "X" }] });
    const result = write.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(FSM_TIMEOUT_MS);
    const error = await result;
    expect(error).toBeInstanceOf(FsmTimeoutError);
    expect((error as FsmTimeoutError).write).toBe(true);
    expect(toUserMessage(error)).toMatch(/may have been saved/);
  });

  it("does not end a request that is still within the time limit", async () => {
    const read = skillSearch("v1/skills");
    let settled = false;
    void read.catch(() => {}).finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(FSM_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });
});

describe("a write whose connection breaks (no answer, but FSM may have saved it)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is reported as an unknown result, like a timeout, never as a plain failure", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const error = await skillApi("v2/skills", { method: "POST", body: [{ tagId: "X" }] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FsmTimeoutError);
    expect((error as FsmTimeoutError).write).toBe(true);
    expect(toUserMessage(error)).toMatch(/could not be reached/);
  });

  it("a read whose connection breaks just asks to try again", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const error = await skillSearch("v1/skills").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FsmTimeoutError);
    expect((error as FsmTimeoutError).write).toBe(false);
  });
});
