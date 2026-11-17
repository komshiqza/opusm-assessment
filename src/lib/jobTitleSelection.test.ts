import { afterEach, describe, expect, it, vi } from "vitest";
import { jobTitleOptions, knownJobTitles, matchesJobTitles } from "@/lib/domain/jobTitleFilter";
import { parseJobTitleSelection } from "./jobTitleSelection";

describe("parseJobTitleSelection", () => {
  it("means nothing selected when nothing valid is stored", () => {
    for (const raw of [null, "", "not json", "{}", '"Electrician"', "[1,2]"]) expect(parseJobTitleSelection(raw)).toEqual([]);
  });

  it("keeps the stored titles once each, without values that are not titles", () => {
    expect(parseJobTitleSelection('["Service Technician","Electrician","Service Technician",3,"",null]')).toEqual(["Service Technician", "Electrician"]);
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
  const load = () => import("./jobTitleSelection");
  const mapStorage = (values: Map<string, string>): Partial<Storage> => ({
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => void values.set(k, v),
    removeItem: (k) => void values.delete(k),
  });
  const selectionOf = (store: Awaited<ReturnType<typeof load>>) => store.parseJobTitleSelection(store.readStoredJobTitles());

  it("keeps the selection after a page reload", async () => {
    const values = new Map<string, string>();
    fakeWindow(mapStorage(values));
    (await load()).saveJobTitles(["Service Technician"]);

    vi.resetModules(); // reload
    expect(selectionOf(await load())).toEqual(["Service Technician"]);
    expect(values.get("skill-management.matrix-job-titles")).toBe('["Service Technician"]');
  });

  it("stores nothing when the selection is cleared (default: all rows)", async () => {
    const values = new Map<string, string>([["skill-management.matrix-job-titles", '["Electrician"]']]);
    fakeWindow(mapStorage(values));
    const store = await load();
    expect(selectionOf(store)).toEqual(["Electrician"]);
    store.saveJobTitles([]);
    expect(selectionOf(store)).toEqual([]);
    expect(values.has("skill-management.matrix-job-titles")).toBe(false);
  });

  it("does not change an open page when another window changes the selection (applies on the next load)", async () => {
    const values = new Map<string, string>();
    fakeWindow(mapStorage(values));
    const store = await load();
    expect(selectionOf(store)).toEqual([]);
    values.set("skill-management.matrix-job-titles", '["Electrician"]'); // another window
    expect(selectionOf(store)).toEqual([]);
  });

  it("keeps working when storage is blocked (selection kept in memory)", async () => {
    const blocked = () => {
      throw new Error("SecurityError: storage is blocked");
    };
    fakeWindow({ getItem: blocked, setItem: blocked, removeItem: blocked });
    const store = await load();
    expect(selectionOf(store)).toEqual([]);
    expect(() => store.saveJobTitles(["Electrician"])).not.toThrow();
    expect(selectionOf(store)).toEqual(["Electrician"]);
    expect(() => store.saveJobTitles([])).not.toThrow();
    expect(selectionOf(store)).toEqual([]);
  });

  it("a malformed stored value means nothing selected", async () => {
    fakeWindow(mapStorage(new Map([["skill-management.matrix-job-titles", "{broken"]])));
    expect(selectionOf(await load())).toEqual([]);
  });

  it("a stored title no loaded person has any more is dropped, so it cannot hide everyone", async () => {
    fakeWindow(mapStorage(new Map([["skill-management.matrix-job-titles", '["Mechanic"]']])));
    const persons = [{ jobTitle: "Service Technician" }, { jobTitle: "Electrician" }, { jobTitle: null }];
    const selection = knownJobTitles(selectionOf(await load()), jobTitleOptions(persons));
    expect(selection).toEqual([]);
    expect(persons.every((p) => matchesJobTitles(p, selection))).toBe(true);
  });
});
