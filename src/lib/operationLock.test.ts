import { describe, expect, it } from "vitest";
import { createOperationLock } from "./operationLock";

describe("createOperationLock (double submit)", () => {
  it("runs a second click that comes before the first save has finished not at all", async () => {
    const lock = createOperationLock();
    let saves = 0;
    let finish!: () => void;
    const save = () =>
      new Promise<void>((resolve) => {
        saves++;
        finish = resolve;
      });
    const first = lock.run(save);
    const second = lock.run(save); // same tick: React has not re-rendered the disabled button yet
    expect(saves).toBe(1);
    expect(lock.running).toBe(true);
    finish();
    await first;
    await expect(second).resolves.toBeUndefined();
    expect(lock.running).toBe(false);
  });

  it("is free again after a failed save", async () => {
    const lock = createOperationLock();
    await expect(lock.run(() => Promise.reject(new Error("FSM error")))).rejects.toThrow("FSM error");
    await expect(lock.run(async () => "saved")).resolves.toBe("saved");
  });
});
