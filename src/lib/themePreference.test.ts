import { afterEach, describe, expect, it, vi } from "vitest";
import { THEME_BOOT_SCRIPT, UI5_THEME, parseThemeChoice } from "./themePreference";

describe("theme choice", () => {
  it("maps each choice to an SAP theme", () => {
    expect(UI5_THEME).toEqual({ light: "sap_horizon", dark: "sap_horizon_dark" });
  });

  it("is Light unless dark was picked (an old saved \"system\" or junk counts as Light)", () => {
    for (const raw of [null, "", "system", "blue", "sap_horizon_dark", "light"]) expect(parseThemeChoice(raw)).toBe("light");
    expect(parseThemeChoice("dark")).toBe("dark");
  });
});

describe("storage (fresh module per test, as on a page load)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });
  const fakeWindow = (storage: Partial<Storage>) =>
    vi.stubGlobal("window", { localStorage: storage, dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });

  it("saves and reads the choice", async () => {
    const values = new Map<string, string>();
    fakeWindow({ getItem: (k) => values.get(k) ?? null, setItem: (k, v) => void values.set(k, v) });
    const store = await import("./themePreference");
    expect(store.readThemeChoice()).toBe("light");
    store.saveThemeChoice("dark");
    expect(store.readThemeChoice()).toBe("dark");
    expect(values.get("skill-management.theme")).toBe("dark");
  });

  it("keeps working when storage is blocked", async () => {
    const blocked = () => {
      throw new Error("SecurityError");
    };
    fakeWindow({ getItem: blocked, setItem: blocked });
    const store = await import("./themePreference");
    expect(store.readThemeChoice()).toBe("light");
    expect(() => store.saveThemeChoice("dark")).not.toThrow();
    expect(store.readThemeChoice()).toBe("dark");
  });
});

describe("head script (runs before the page paints)", () => {
  /** Runs the real inline script with a fake localStorage and returns the color-scheme it set. */
  const runBootScript = (getItem: () => string | null) => {
    const style = { colorScheme: "" };
    new Function("localStorage", "document", THEME_BOOT_SCRIPT)({ getItem }, { documentElement: { style } });
    return style.colorScheme;
  };

  it("uses the saved light or dark choice", () => {
    expect(runBootScript(() => "dark")).toBe("dark");
    expect(runBootScript(() => "light")).toBe("light");
  });

  it("starts light when nothing valid is saved or storage is blocked", () => {
    expect(runBootScript(() => null)).toBe("light");
    expect(runBootScript(() => "system")).toBe("light");
    expect(runBootScript(() => "blue")).toBe("light");
    expect(
      runBootScript(() => {
        throw new Error("SecurityError");
      }),
    ).toBe("light");
  });
});
