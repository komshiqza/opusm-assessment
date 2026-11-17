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

  it("never write a plural as \"(s)\" or \"(en)\": the count picks the right form", () => {
    const guessedPlural = /\w\((s|e|en|n)\)/;
    expect(Object.entries({ ...en }).filter(([, text]) => guessedPlural.test(text))).toEqual([]);
    expect(Object.entries(de).filter(([, text]) => guessedPlural.test(text))).toEqual([]);
  });

  it("have no empty text", () => {
    expect(Object.entries({ ...en }).filter(([, text]) => !text)).toEqual([]);
    expect(Object.entries(de).filter(([, text]) => !text)).toEqual([]);
  });
});

describe("certificate preview texts", () => {
  it("exist in both languages, the error with FSM's reason", () => {
    expect(t("certificates.loading", undefined, "de")).toBe("Zertifikat wird geladen…");
    expect(t("certificates.loadFailed", { error: "Timeout." }, "en")).toBe("Could not load the certificate. Timeout.");
    expect(t("certificates.loadFailed", { error: "Timeout." }, "de")).toBe("Das Zertifikat konnte nicht geladen werden. Timeout.");
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

describe("certificate counts", () => {
  it("say 1 certificate or 2 certificates after saving", () => {
    expect(tn("assign.savedWith", 1, undefined, "en")).toBe("Assignment saved with 1 certificate");
    expect(tn("assign.savedWith", 2, undefined, "en")).toBe("Assignment saved with 2 certificates");
    expect(tn("assign.savedWith", 1, undefined, "de")).toBe("Zuweisung mit 1 Zertifikat gespeichert");
    expect(tn("assign.savedWith", 2, undefined, "de")).toBe("Zuweisung mit 2 Zertifikaten gespeichert");
  });

  it("warn about the attached certificate or certificates when removing an assignment", () => {
    expect(tn("assign.removeCertificates", 1, undefined, "en")).toBe(" The attached certificate will be deleted as well.");
    expect(tn("assign.removeCertificates", 2, undefined, "en")).toBe(" The 2 attached certificates will be deleted as well.");
    expect(tn("assign.removeCertificates", 1, undefined, "de")).toBe(" Das angehängte Zertifikat wird ebenfalls gelöscht.");
    expect(tn("assign.removeCertificates", 2, undefined, "de")).toBe(" Die 2 angehängten Zertifikate werden ebenfalls gelöscht.");
  });

  it("count assignments and certificates when a skill is deleted", () => {
    const deleted = (assignments: number, certificates: number, lang: "en" | "de") =>
      t("catalogue.deletedWith", { name: "Welding", assignments: tn("delete.assignments", assignments, undefined, lang), certificates: tn("delete.withCertificates", certificates, undefined, lang) }, lang);
    expect(deleted(1, 1, "en")).toBe("Skill “Welding” deleted with 1 assignment and 1 certificate");
    expect(deleted(2, 3, "en")).toBe("Skill “Welding” deleted with 2 assignments and 3 certificates");
    expect(deleted(1, 1, "de")).toBe("Qualifikation «Welding» mit 1 Zuweisung und 1 Zertifikat gelöscht");
    expect(deleted(2, 3, "de")).toBe("Qualifikation «Welding» mit 2 Zuweisungen und 3 Zertifikaten gelöscht");
  });

  it("name the certificates in the delete dialog", () => {
    const inUse = (n: number, lang: "en" | "de") => t("deleteDialog.inUseCertificates", { certificates: tn("delete.withCertificates", n, undefined, lang) }, lang);
    expect(inUse(1, "en")).toBe(" with 1 certificate");
    expect(inUse(4, "en")).toBe(" with 4 certificates");
    expect(inUse(1, "de")).toBe(", mit 1 Zertifikat");
    expect(inUse(4, "de")).toBe(", mit 4 Zertifikaten");
  });
});
