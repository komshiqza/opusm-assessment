import { afterEach, describe, expect, it, vi } from "vitest";
import { loadBlobUrl } from "./blobUrl";

/** A file load the test finishes by hand. */
function pendingLoad() {
  let finish!: (blob: Blob) => void;
  let fail!: (e: unknown) => void;
  const promise = new Promise<Blob>((resolve, reject) => ((finish = resolve), (fail = reject)));
  return { load: () => promise, finish, fail };
}

describe("loadBlobUrl (the certificate preview's local file URL)", () => {
  const created: string[] = [];
  const revoked: string[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
    const url = `blob:test-${created.length}`;
    created.push(url);
    return url;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => void revoked.push(url));
  afterEach(() => ((created.length = 0), (revoked.length = 0)));

  it("shows the file and frees it when the preview closes", async () => {
    const file = pendingLoad();
    const onLoaded = vi.fn();
    const close = loadBlobUrl(file.load, onLoaded, vi.fn());
    file.finish(new Blob(["pdf"]));
    await Promise.resolve();
    expect(onLoaded).toHaveBeenCalledWith("blob:test-0");
    close();
    expect(revoked).toEqual(created);
  });

  it("keeps nothing in memory when the preview closes before the file arrives", async () => {
    const file = pendingLoad();
    const onLoaded = vi.fn();
    const close = loadBlobUrl(file.load, onLoaded, vi.fn());
    close();
    file.finish(new Blob(["pdf"]));
    await Promise.resolve();
    expect(created.filter((url) => !revoked.includes(url))).toEqual([]);
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it("reports a failed load, but not after the preview closed", async () => {
    const open = pendingLoad();
    const onFailed = vi.fn();
    loadBlobUrl(open.load, vi.fn(), onFailed);
    open.fail(new Error("Timeout"));
    await Promise.resolve().then(() => undefined);
    expect(onFailed).toHaveBeenCalledOnce();

    const closed = pendingLoad();
    const onFailedLate = vi.fn();
    loadBlobUrl(closed.load, vi.fn(), onFailedLate)();
    closed.fail(new Error("Timeout"));
    await Promise.resolve().then(() => undefined);
    expect(onFailedLate).not.toHaveBeenCalled();
  });
});
