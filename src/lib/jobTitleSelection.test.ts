import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_JOB_TITLE, NO_JOB_TITLE, jobTitleOptions, matchesJobTitles, selectedJobTitles } from "@/lib/domain/jobTitleFilter";
import { parseJobTitleSelection, recordViewTitles } from "./jobTitleSelection";

describe("parseJobTitleSelection", () => {
  it("means no stored choice (null) when nothing valid is stored", () => {
    for (const raw of [null, "", "not json", "{}", '"Electrician"', "[1,2]", '["Electrician",3]', '[""]']) expect(parseJobTitleSelection(raw)).toBeNull();
  });

  it("keeps an explicit empty choice", () => {
    expect(parseJobTitleSelection("[]")).toEqual([]);
  });

  it("keeps the stored titles once each", () => {
    expect(parseJobTitleSelection('["Service Technician","Electrician","Service Technician"]')).toEqual(["Service Technician", "Electrician"]);
  });
});

describe("storage (fresh module per test, as on a page load)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const KEY = "skill-management.matrix-job-titles";
  const fakeWindow = (storage: Partial<Storage>) => {
    vi.stubGlobal("window", { localStorage: storage, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
  };
  const load = () => import("./jobTitleSelection");
  const mapStorage = (values: Map<string, string>): Partial<Storage> => ({
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => void values.set(k, v),
    removeItem: (k) => void values.delete(k),
  });
  const blockedStorage = (): Partial<Storage> => {
    const blocked = () => {
      throw new Error("SecurityError: storage is blocked");
    };
    return { getItem: blocked, setItem: blocked, removeItem: blocked };
  };
  const storedOf = (store: Awaited<ReturnType<typeof load>>) => store.parseJobTitleSelection(store.readStoredJobTitles());
  const reload = async () => {
    vi.resetModules();
    return load();
  };

  /** The persons of the shared company: service technicians plus admin, Arturs and Dominic without a job title. */
  const persons = [{ jobTitle: "Service Technician" }, { jobTitle: "Service Technician" }, { jobTitle: null }];
  const options = jobTitleOptions(persons);
  /** What the matrix shows for a stored choice. */
  const shownOf = async (store: Awaited<ReturnType<typeof load>>, withOptions = options) => selectedJobTitles(storedOf(store), withOptions);

  it("keeps the selection after a page reload", async () => {
    const values = new Map<string, string>();
    fakeWindow(mapStorage(values));
    (await load()).saveJobTitles(["Electrician"]);
    expect(storedOf(await reload())).toEqual(["Electrician"]);
    expect(values.get(KEY)).toBe('["Electrician"]');
  });

  it("does not change an open page when another window changes the selection (applies on the next load)", async () => {
    const values = new Map<string, string>();
    fakeWindow(mapStorage(values));
    const store = await load();
    expect(storedOf(store)).toBeNull();
    values.set(KEY, '["Electrician"]'); // another window
    expect(storedOf(store)).toBeNull();
  });

  it("uses the new selection when only writing fails", async () => {
    fakeWindow({
      ...mapStorage(new Map()),
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    const store = await load();
    store.saveJobTitles(["Electrician"]);
    expect(storedOf(store)).toEqual(["Electrician"]);
  });

  describe("default selection (scenarios)", () => {
    it("1. no stored value: Service Technician when someone has exactly that title, else nothing (all rows)", async () => {
      expect(DEFAULT_JOB_TITLE).toBe("Service Technician");
      fakeWindow(mapStorage(new Map()));
      const store = await load();
      expect(await shownOf(store)).toEqual(["Service Technician"]);
      expect(persons.filter((p) => matchesJobTitles(p, ["Service Technician"]))).toHaveLength(2);
      expect(await shownOf(store, jobTitleOptions([{ jobTitle: "Electrician" }, { jobTitle: "service technician" }, { jobTitle: null }]))).toEqual([]);
    });

    it("1. storage blocked: the default too; a choice then lives in this page only", async () => {
      fakeWindow(blockedStorage());
      const store = await load();
      expect(await shownOf(store)).toEqual(["Service Technician"]);
      expect(() => store.saveJobTitles([])).not.toThrow();
      expect(await shownOf(store)).toEqual([]);
      expect(() => store.resetJobTitles()).not.toThrow();
      expect(await shownOf(store)).toEqual(["Service Technician"]);
    });

    it("2. the user clears the filter: stored as an explicit empty choice, so a reload shows everyone", async () => {
      const values = new Map<string, string>();
      fakeWindow(mapStorage(values));
      (await load()).saveJobTitles([]);
      expect(values.get(KEY)).toBe("[]");
      const store = await reload();
      expect(await shownOf(store)).toEqual([]);
      expect(persons.every((p) => matchesJobTitles(p, []))).toBe(true);
    });

    it("3. Reset filters returns to the start state: Service Technician again, also after a reload", async () => {
      const values = new Map<string, string>([[KEY, "[]"]]);
      fakeWindow(mapStorage(values));
      const store = await load();
      store.resetJobTitles();
      expect(values.has(KEY)).toBe(false);
      expect(await shownOf(store)).toEqual(["Service Technician"]);
      expect(await shownOf(await reload())).toEqual(["Service Technician"]);
    });

    it("4. a stored title nobody has any more is dropped; nothing left means everyone, not the default", async () => {
      fakeWindow(mapStorage(new Map([[KEY, '["Mechanic"]']])));
      expect(await shownOf(await load())).toEqual([]);
      vi.resetModules();
      fakeWindow(mapStorage(new Map([[KEY, `["Mechanic","${NO_JOB_TITLE}"]`]])));
      expect(await shownOf(await load())).toEqual([NO_JOB_TITLE]);
    });

    it("5. a malformed stored value counts as no stored value, so it gets the default", async () => {
      for (const raw of ["{broken", '"Service Technician"', "[1,2]"]) {
        vi.resetModules();
        fakeWindow(mapStorage(new Map([[KEY, raw]])));
        expect(await shownOf(await load())).toEqual(["Service Technician"]);
      }
    });
  });
});

describe("recordViewTitles ('Show each FSM record' lists every record, so it sets the Job title choice aside)", () => {
  it.each([
    ["on, from the default (nothing stored)", true, "", null, { stored: "[]", setAside: "" }],
    ["on, from a chosen title", true, '["Electrician"]', null, { stored: "[]", setAside: '["Electrician"]' }],
    ["off, untouched meanwhile: the default comes back", false, "[]", "", { stored: "", setAside: null }],
    ["off, untouched meanwhile: the chosen title comes back", false, "[]", '["Electrician"]', { stored: '["Electrician"]', setAside: null }],
    ["off, after the user picked a title in the record view: theirs stays", false, '["Dispatcher"]', "", { stored: '["Dispatcher"]', setAside: null }],
    ["off, nothing set aside (e.g. after a reload)", false, "[]", null, { stored: "[]", setAside: null }],
  ] as const)("%s", (_case, on, stored, setAside, expected) => {
    expect(recordViewTitles(on, stored, setAside)).toEqual(expected);
  });
});
