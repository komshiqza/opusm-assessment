/** What a finished load shows on screen. */
export type LoadResult<T> = { ok: true; data: T } | { ok: false; error: unknown };

/**
 * Runs loads where only the newest answer counts (a reload started later replaces an earlier one).
 * `show` gets only the newest answer. Each call resolves to whether the newest load succeeded, so a
 * caller that changed something knows if the screen now shows its change ("Saved, but the list could
 * not be refreshed" otherwise). Never rejects.
 */
export function createLatestLoader<T>(load: () => Promise<T>, show: (result: LoadResult<T>) => void): () => Promise<boolean> {
  let latest = 0;
  let newest: Promise<boolean> = Promise.resolve(true);

  const run = (): Promise<boolean> => {
    const id = ++latest;
    const attempt = load().then(
      (data): LoadResult<T> => ({ ok: true, data }),
      (error: unknown): LoadResult<T> => ({ ok: false, error }),
    );
    const outcome = attempt.then((result) => {
      if (id !== latest) return newest; // a newer reload was started: its answer decides
      show(result);
      return result.ok;
    });
    newest = outcome;
    return outcome;
  };
  return run;
}
