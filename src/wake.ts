export interface WakeSentinel {
  release(): Promise<void> | void;
}

export interface WakeApi {
  request(type: "screen"): Promise<WakeSentinel>;
}

export interface WakeController {
  supported: boolean;
  acquire(): Promise<void>;
  release(): void;
}

export function createWake(api: WakeApi | null): WakeController {
  let sentinel: WakeSentinel | null = null;
  let epoch = 0;

  return {
    supported: api != null,
    async acquire() {
      if (!api) return;
      const token = ++epoch;
      try {
        const next = await api.request("screen");
        if (token !== epoch) {
          await next.release();
          return;
        }
        const previous = sentinel;
        sentinel = next;
        if (previous && previous !== next) {
          await previous.release();
        }
      } catch {
        if (token === epoch) sentinel = null;
      }
    },
    release() {
      epoch += 1;
      const current = sentinel;
      sentinel = null;
      if (!current) return;
      try {
        void Promise.resolve(current.release()).catch(() => undefined);
      } catch {
        /* already released */
      }
    },
  };
}

export function readWakeApi(): WakeApi | null {
  if (typeof navigator === "undefined") return null;
  const lock = (navigator as Navigator & { wakeLock?: WakeApi }).wakeLock;
  return lock ?? null;
}
