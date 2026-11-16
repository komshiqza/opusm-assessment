import { describe, expect, it } from "vitest";
import { MAX_CERTIFICATE_BYTES, checkCertificate, inspectCertificateFile, splitCertificateFiles } from "./certificateRules";

const PDF = new TextEncoder().encode("%PDF-1.4\n");
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const EXE = new TextEncoder().encode("MZ\x90\x00\x03\x00\x00\x00"); // Windows program header

describe("checkCertificate (shared by browser and server)", () => {
  it.each([
    ["cert.pdf", PDF, "PDF"],
    ["scan.png", PNG, "PNG"],
    ["photo.jpg", JPEG, "JPEG"],
    ["photo.JPEG", JPEG, "JPEG"],
  ] as const)("accepts %s with matching content as %s", (fileName, head, type) => {
    expect(checkCertificate({ fileName, size: 1000, head })).toEqual({ ok: true, type });
  });

  it("refuses a renamed program (virus.exe saved as cert.pdf)", () => {
    expect(checkCertificate({ fileName: "cert.pdf", size: 1000, head: EXE })).toMatchObject({ ok: false, error: expect.stringMatching(/not a PDF, JPG or PNG/) });
  });

  it("refuses content that does not match the extension", () => {
    expect(checkCertificate({ fileName: "scan.pdf", size: 1000, head: PNG })).toMatchObject({ ok: false, error: expect.stringMatching(/is a PNG.*\.pdf/) });
  });

  it("refuses a declared type that does not match the content", () => {
    expect(checkCertificate({ fileName: "cert.pdf", size: 1000, head: PDF, declaredType: "PNG" })).toMatchObject({ ok: false, error: expect.stringMatching(/PNG/) });
    expect(checkCertificate({ fileName: "cert.pdf", size: 1000, head: PDF, declaredType: "PDF" })).toEqual({ ok: true, type: "PDF" });
  });

  it("allows exactly 5 MB and refuses one byte more", () => {
    expect(MAX_CERTIFICATE_BYTES).toBe(5_242_880);
    expect(checkCertificate({ fileName: "a.pdf", size: MAX_CERTIFICATE_BYTES, head: PDF })).toMatchObject({ ok: true });
    expect(checkCertificate({ fileName: "a.pdf", size: MAX_CERTIFICATE_BYTES + 1, head: PDF })).toMatchObject({ ok: false, tooLarge: true });
    // No rounded size in the message: 5 MB + 1 byte would read "5.0 MB is larger than 5 MB".
    expect(checkCertificate({ fileName: "a.pdf", size: MAX_CERTIFICATE_BYTES + 1, head: PDF })).toMatchObject({ error: "a.pdf is larger than the 5 MB limit." });
  });

  it("refuses empty files, unknown extensions and content too short to identify", () => {
    expect(checkCertificate({ fileName: "a.pdf", size: 0, head: new Uint8Array() })).toMatchObject({ ok: false });
    expect(checkCertificate({ fileName: "notes.docx", size: 10, head: PDF })).toMatchObject({ ok: false, error: expect.stringMatching(/only PDF, JPG and PNG/) });
    expect(checkCertificate({ fileName: "noextension", size: 10, head: PDF })).toMatchObject({ ok: false });
    expect(checkCertificate({ fileName: "a.png", size: 3, head: PNG.slice(0, 3) })).toMatchObject({ ok: false });
  });
});

describe("browser: picked files are checked by their first bytes", () => {
  const file = (name: string, bytes: Uint8Array, size = 0) => new File([bytes as BlobPart, new Uint8Array(size)], name);

  it("reads the content of a picked file", async () => {
    expect(await inspectCertificateFile(file("cert.pdf", PDF, 100))).toEqual({ ok: true, type: "PDF" });
    expect(await inspectCertificateFile(file("cert.pdf", EXE, 100))).toMatchObject({ ok: false });
  });

  it("checks the size of the original file", async () => {
    expect(await inspectCertificateFile(file("big.pdf", PDF, MAX_CERTIFICATE_BYTES - PDF.length))).toMatchObject({ ok: true });
    expect(await inspectCertificateFile(file("big.pdf", PDF, MAX_CERTIFICATE_BYTES - PDF.length + 1))).toMatchObject({ ok: false, tooLarge: true });
  });

  it("keeps valid files in order and explains the others", async () => {
    const { valid, problems } = await splitCertificateFiles([file("a.pdf", PDF), file("notes.docx", PDF), file("fake.png", EXE), file("b.png", PNG)]);
    expect(valid.map((f) => f.name)).toEqual(["a.pdf", "b.png"]);
    expect(problems).toEqual([expect.stringMatching(/^notes\.docx: only PDF/), expect.stringMatching(/^fake\.png: .*not a PDF, JPG or PNG/)]);
  });
});
