import { describe, expect, it } from "vitest";
import { de, en } from "./messages";
import { t, tn } from "./t";

describe("English and German texts", () => {
  it("have exactly the same keys (a text missing in one language fails here)", () => {
    const missingInGerman = Object.keys(en).filter((k) => !(k in de));
    const missingInEnglish = Object.keys(de).filter((k) => !(k in en));
    expect({ missingInGerman, missingInEnglish }).toEqual({ missingInGerman: [], missingInEnglish: [] });
  });

  it("use the same placeholders in both languages", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const different = (Object.keys(en) as (keyof typeof en)[]).filter((k) => placeholders(en[k]).join() !== placeholders(de[k]).join());
    expect(different).toEqual([]);
  });

  it("use Swiss spelling in German: never ß", () => {
    expect(Object.entries(de).filter(([, text]) => text.includes("ß"))).toEqual([]);
  });

  it("have no empty text", () => {
    expect(Object.entries({ ...en }).filter(([, text]) => !text)).toEqual([]);
    expect(Object.entries(de).filter(([, text]) => !text)).toEqual([]);
  });
});

describe("t and tn", () => {
  it("fill placeholders and pick the plural form", () => {
    expect(t("status.expiresOn", { date: "11.12.2026" }, "en")).toBe("Expires 11.12.2026");
    expect(t("status.expiresOn", { date: "11.12.2026" }, "de")).toBe("Läuft am 11.12.2026 ab");
    expect(tn("expiry.daysLeft", 1, undefined, "de")).toBe("Noch 1 Tag");
    expect(tn("expiry.daysLeft", 5, undefined, "en")).toBe("5 days left");
  });
});
