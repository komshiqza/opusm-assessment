import { describe, expect, it } from "vitest";
import { createLatestLoader } from "./latestLoader";

/** A load the test finishes by hand, in any order. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createLatestLoader (reload after a change)", () => {
  it("reports a failed reload as failed, so a dialog can say the list is not refreshed", async () => {
    const shown: string[] = [];
    const run = createLatestLoader(
      () => Promise.reject(new Error("FSM down")),
      (result) => shown.push(result.ok ? "data" : "error"),
    );
    await expect(run()).resolves.toBe(false);
    expect(shown).toEqual(["error"]);
  });

  it("reports a successful reload as ok and shows its data", async () => {
    const shown: unknown[] = [];
    const run = createLatestLoader(
      async () => "fresh",
      (result) => shown.push(result.ok ? result.data : "error"),
    );
    await expect(run()).resolves.toBe(true);
    expect(shown).toEqual(["fresh"]);
  });

  it("shows only the newest answer, and an older caller gets the newest result", async () => {
    const loads = [deferred<string>(), deferred<string>()];
    let call = 0;
    const shown: unknown[] = [];
    const run = createLatestLoader(
      () => loads[call++].promise,
      (result) => shown.push(result.ok ? result.data : "error"),
    );
    const older = run();
    const newer = run();
    loads[0].reject(new Error("old answer failed")); // superseded: neither shown nor reported
    loads[1].resolve("new");
    await expect(older).resolves.toBe(true);
    await expect(newer).resolves.toBe(true);
    expect(shown).toEqual(["new"]);
  });

  it("an older success does not hide that the newest reload failed", async () => {
    const loads = [deferred<string>(), deferred<string>()];
    let call = 0;
    const run = createLatestLoader(
      () => loads[call++].promise,
      () => {},
    );
    const older = run();
    const newer = run();
    loads[0].resolve("old");
    loads[1].reject(new Error("FSM down"));
    await expect(older).resolves.toBe(false);
    await expect(newer).resolves.toBe(false);
  });
});
