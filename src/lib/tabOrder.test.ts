import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TAB_ORDER, isDefaultTabOrder, moveTab, parseTabOrder, readStoredTabOrder, resetTabOrder, saveTabOrder } from "./tabOrder";

describe("parseTabOrder", () => {
  it("uses the default order when nothing valid is stored", () => {
    expect(DEFAULT_TAB_ORDER).toEqual(["matrix", "expiry", "find", "catalogue"]);
    for (const raw of [null, "", "not json", "{}", "[1,2]"]) expect(parseTabOrder(raw)).toEqual(DEFAULT_TAB_ORDER);
  });

  it("keeps a stored order, drops unknown and duplicate keys, appends missing tabs", () => {
    expect(parseTabOrder('["catalogue","matrix"]')).toEqual(["catalogue", "matrix", "expiry", "find"]);
    expect(parseTabOrder('["find","hack","find","matrix"]')).toEqual(["find", "matrix", "expiry", "catalogue"]);
  });
});

describe("moveTab", () => {
  it("moves a tab before or after another", () => {
    expect(moveTab(DEFAULT_TAB_ORDER, "catalogue", "matrix", "Before")).toEqual(["catalogue", "matrix", "expiry", "find"]);
    expect(moveTab(DEFAULT_TAB_ORDER, "matrix", "find", "After")).toEqual(["expiry", "find", "matrix", "catalogue"]);
    expect(moveTab(DEFAULT_TAB_ORDER, "find", "find", "After")).toEqual(DEFAULT_TAB_ORDER);
  });

  it("knows the default order", () => {
    expect(isDefaultTabOrder(DEFAULT_TAB_ORDER)).toBe(true);
    expect(isDefaultTabOrder(moveTab(DEFAULT_TAB_ORDER, "find", "matrix", "Before"))).toBe(false);
  });
});

describe("storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  const fakeWindow = (storage: Partial<Storage>) => {
    vi.stubGlobal("window", { localStorage: storage, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
  };

  it("saves, reads and resets the order", () => {
    const values = new Map<string, string>();
    fakeWindow({ getItem: (k) => values.get(k) ?? null, setItem: (k, v) => void values.set(k, v), removeItem: (k) => void values.delete(k) });
    saveTabOrder(["find", "matrix", "expiry", "catalogue"]);
    expect(parseTabOrder(readStoredTabOrder())).toEqual(["find", "matrix", "expiry", "catalogue"]);
    resetTabOrder();
    expect(parseTabOrder(readStoredTabOrder())).toEqual(DEFAULT_TAB_ORDER);
  });

  it("keeps working when storage is blocked (order kept in memory)", () => {
    const blocked = () => {
      throw new Error("SecurityError: storage is blocked");
    };
    fakeWindow({ getItem: blocked, setItem: blocked, removeItem: blocked });
    expect(() => saveTabOrder(["catalogue", "matrix", "expiry", "find"])).not.toThrow();
    expect(parseTabOrder(readStoredTabOrder())).toEqual(["catalogue", "matrix", "expiry", "find"]);
    expect(() => resetTabOrder()).not.toThrow();
    expect(parseTabOrder(readStoredTabOrder())).toEqual(DEFAULT_TAB_ORDER);
  });
});
