import { describe, expect, it, vi } from "vitest";
import { createWake, type WakeSentinel } from "./wake";

describe("wake lock", () => {
  it("drops an in-flight lock if release wins the race", async () => {
    let resolve: (sentinel: WakeSentinel) => void = () => undefined;
    const api = {
      request: () => new Promise<WakeSentinel>((res) => { resolve = res; }),
    };
    const wake = createWake(api);
    const pending = wake.acquire();
    wake.release();
    const release = vi.fn();
    resolve({ release });
    await pending;
    expect(release).toHaveBeenCalledOnce();
  });

  it("replaces a lock when asked again", async () => {
    const sentinels: WakeSentinel[] = [];
    const api = {
      request: async () => {
        const sentinel = { release: vi.fn() };
        sentinels.push(sentinel);
        return sentinel;
      },
    };
    const wake = createWake(api);
    await wake.acquire();
    await wake.acquire();
    expect(sentinels[0].release).toHaveBeenCalled();
    expect(sentinels[1].release).not.toHaveBeenCalled();
    wake.release();
    expect(sentinels[1].release).toHaveBeenCalled();
  });

  it("ignores a missing or failing API", async () => {
    const missing = createWake(null);
    await missing.acquire();
    missing.release();
    expect(missing.supported).toBe(false);
    const failing = createWake({ request: async () => { throw new Error("denied"); } });
    await expect(failing.acquire()).resolves.toBeUndefined();
  });
});
