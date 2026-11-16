/**
 * A synchronous "one at a time" lock for a dialog's save or confirm. A second click that arrives
 * before React has re-rendered the disabled button is ignored (it resolves to undefined).
 */
export function createOperationLock() {
  let running = false;
  return {
    get running() {
      return running;
    },
    async run<T>(work: () => Promise<T>): Promise<T | undefined> {
      if (running) return undefined;
      running = true;
      try {
        return await work();
      } finally {
        running = false;
      }
    },
  };
}
