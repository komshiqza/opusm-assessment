import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TAB_ORDER, isDefaultTabOrder, moveTab, parseTabOrder } from "./tabOrder";

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

describe("storage (fresh module per test, as on a page load)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const fakeWindow = (storage: Partial<Storage>) => {
    vi.stubGlobal("window", { localStorage: storage, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
  };
  const load = () => import("./tabOrder");
  const mapStorage = (values: Map<string, string>): Partial<Storage> => ({
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => void values.set(k, v),
    removeItem: (k) => void values.delete(k),
  });

  it("saves, reads and resets the order", async () => {
    const values = new Map<string, string>();
    fakeWindow(mapStorage(values));
    const store = await load();
    store.saveTabOrder(["find", "matrix", "expiry", "catalogue"]);
    expect(store.parseTabOrder(store.readStoredTabOrder())).toEqual(["find", "matrix", "expiry", "catalogue"]);
    expect(values.get("skill-management.tab-order")).toBe('["find","matrix","expiry","catalogue"]');
    store.resetTabOrder();
    expect(store.parseTabOrder(store.readStoredTabOrder())).toEqual(DEFAULT_TAB_ORDER);
    expect(values.has("skill-management.tab-order")).toBe(false);
  });

  it("reads the saved order when the page opens", async () => {
    fakeWindow(mapStorage(new Map([["skill-management.tab-order", '["catalogue","matrix","expiry","find"]']])));
    const store = await load();
    expect(store.parseTabOrder(store.readStoredTabOrder())).toEqual(["catalogue", "matrix", "expiry", "find"]);
  });

  it("does not change an open page when another window changes the order (applies on the next load)", async () => {
    const values = new Map<string, string>();
    fakeWindow(mapStorage(values));
    const store = await load();
    expect(store.readStoredTabOrder()).toBe("");
    values.set("skill-management.tab-order", '["find","matrix","expiry","catalogue"]'); // another window
    expect(store.parseTabOrder(store.readStoredTabOrder())).toEqual(DEFAULT_TAB_ORDER);
  });

  it("keeps working when storage is blocked (order kept in memory)", async () => {
    const blocked = () => {
      throw new Error("SecurityError: storage is blocked");
    };
    fakeWindow({ getItem: blocked, setItem: blocked, removeItem: blocked });
    const store = await load();
    expect(store.parseTabOrder(store.readStoredTabOrder())).toEqual(DEFAULT_TAB_ORDER);
    expect(() => store.saveTabOrder(["catalogue", "matrix", "expiry", "find"])).not.toThrow();
    expect(store.parseTabOrder(store.readStoredTabOrder())).toEqual(["catalogue", "matrix", "expiry", "find"]);
    expect(() => store.resetTabOrder()).not.toThrow();
    expect(store.parseTabOrder(store.readStoredTabOrder())).toEqual(DEFAULT_TAB_ORDER);
  });

  it("uses the new order when only writing fails", async () => {
    const values = new Map<string, string>([["skill-management.tab-order", '["catalogue","matrix","expiry","find"]']]);
    fakeWindow({
      ...mapStorage(values),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    const store = await load();
    store.saveTabOrder(["find", "matrix", "expiry", "catalogue"]);
    expect(store.parseTabOrder(store.readStoredTabOrder())).toEqual(["find", "matrix", "expiry", "catalogue"]);
  });
});
