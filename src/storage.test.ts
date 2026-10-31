import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./settings";
import { HINTS_KEY, loadHints, loadPersisted, saveHints, savePersisted, STORAGE_KEY } from "./storage";

function mem() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

describe("storage", () => {
  it("round-trips the v1 shape", () => {
    const store = mem();
    savePersisted(store, { cfg: { ...DEFAULT_SETTINGS, work: 40 }, sound: false, vibe: true, awake: false });
    expect(store.data.has(STORAGE_KEY)).toBe(true);
    expect(JSON.parse(store.data.get(STORAGE_KEY)!)).toEqual({
      cfg: { prepare: 10, work: 40, rest: 10, rounds: 8, sets: 1, setRest: 60, cool: 0, beeps: 3 },
      sound: false,
      vibe: true,
      awake: false,
    });
    expect(loadPersisted(store).cfg.work).toBe(40);
    expect(loadPersisted(store).sound).toBe(false);
  });

  it("falls back when storage is empty, corrupt, partial, or throwing", () => {
    const empty = mem();
    expect(loadPersisted(empty).cfg).toEqual(DEFAULT_SETTINGS);
    const bad = mem();
    bad.setItem(STORAGE_KEY, "{");
    expect(loadPersisted(bad).cfg).toEqual(DEFAULT_SETTINGS);
    const partial = mem();
    partial.setItem(STORAGE_KEY, JSON.stringify({ cfg: { work: "40", beeps: 4 }, sound: "yes" }));
    const loaded = loadPersisted(partial);
    expect(loaded.cfg.work).toBe(40);
    expect(loaded.cfg.prepare).toBe(10);
    expect(loaded.cfg.beeps).toBe(3);
    expect(loaded.sound).toBe(true);
    const exploding = {
      getItem() { throw new Error("private"); },
      setItem() { throw new Error("quota"); },
    };
    expect(loadPersisted(exploding).cfg.work).toBe(20);
    expect(savePersisted(exploding, { cfg: DEFAULT_SETTINGS, sound: true, vibe: true, awake: true })).toBe(false);
  });

  it("stores hint dismissals separately", () => {
    const store = mem();
    expect(loadHints(store)).toEqual({ dismissedAudio: false, dismissedInstall: false });
    saveHints(store, { dismissedAudio: true, dismissedInstall: false });
    expect(store.data.has(HINTS_KEY)).toBe(true);
    expect(loadHints(store).dismissedAudio).toBe(true);
    store.setItem(HINTS_KEY, "nope");
    expect(loadHints(store).dismissedInstall).toBe(false);
  });
});
