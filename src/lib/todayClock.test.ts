import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("today clock (the date changes at local midnight)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("switches to the next day at midnight and tells the screen", async () => {
    vi.setSystemTime(new Date(2026, 10, 16, 23, 59, 30));
    const clock = await import("./todayClock");
    const changed = vi.fn();
    const unsubscribe = clock.subscribeToday(changed);
    expect(clock.readToday()).toBe("2026-11-16");

    vi.advanceTimersByTime(29_000); // 23:59:59
    expect(changed).not.toHaveBeenCalled();
    expect(clock.readToday()).toBe("2026-11-16");

    vi.advanceTimersByTime(2_000); // 00:00:01
    expect(changed).toHaveBeenCalledTimes(1);
    expect(clock.readToday()).toBe("2026-11-17");

    vi.advanceTimersByTime(24 * 60 * 60 * 1000); // and the midnight after that
    expect(clock.readToday()).toBe("2026-11-18");
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("catches up when a sleeping tab becomes visible again", async () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    });
    vi.setSystemTime(new Date(2026, 10, 16, 18, 0));
    const clock = await import("./todayClock");
    const changed = vi.fn();
    const unsubscribe = clock.subscribeToday(changed);

    // The laptop slept through midnight: timers did not run, the system clock moved on.
    vi.setSystemTime(new Date(2026, 10, 17, 8, 0));
    listeners.get("visibilitychange")?.();
    expect(clock.readToday()).toBe("2026-11-17");
    expect(changed).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(listeners.has("visibilitychange")).toBe(false);
  });
});
