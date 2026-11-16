import { loadCertificateFile } from "@/lib/skills/certificates";
import type { Certificate } from "@/lib/skills/types";

/** Loads the file through the repository (FSM errors keep their message) and saves it under its own name. */
export async function saveCertificate(certificate: Certificate): Promise<void> {
  const url = URL.createObjectURL(await loadCertificateFile(certificate));
  const link = document.createElement("a");
  link.href = url;
  link.download = certificate.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
