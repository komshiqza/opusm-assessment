/**
 * Loads a file and hands it over as a local blob URL (for the certificate preview). The returned
 * function is the cleanup: it frees the URL, and a file that arrives after the cleanup is never
 * turned into a URL, so a preview closed while loading keeps nothing in memory.
 */
export function loadBlobUrl(load: () => Promise<Blob>, onLoaded: (url: string) => void, onFailed: (error: unknown) => void): () => void {
  let url: string | null = null;
  let cancelled = false;
  load().then(
    (blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      onLoaded(url);
    },
    (e: unknown) => {
      if (!cancelled) onFailed(e);
    },
  );
  return () => {
    cancelled = true;
    if (url) URL.revokeObjectURL(url);
  };
}
