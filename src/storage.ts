import { clampSettings, DEFAULT_SETTINGS } from "./settings";
import type { Settings } from "./types";

export const STORAGE_KEY = "tabata.v1";
export const HINTS_KEY = "tabata.hints.v1";

export interface Persisted {
  cfg: Settings;
  sound: boolean;
  vibe: boolean;
  awake: boolean;
}

export interface HintFlags {
  dismissedAudio: boolean;
  dismissedInstall: boolean;
}

export const DEFAULT_PERSISTED: Persisted = {
  cfg: { ...DEFAULT_SETTINGS },
  sound: true,
  vibe: true,
  awake: true,
};

export const EMPTY_HINTS: HintFlags = {
  dismissedAudio: false,
  dismissedInstall: false,
};

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function loadPersisted(storage: KeyValueStore): Persisted {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { cfg: { ...DEFAULT_SETTINGS }, sound: true, vibe: true, awake: true };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { cfg: { ...DEFAULT_SETTINGS }, sound: true, vibe: true, awake: true };
    return {
      cfg: clampSettings(isRecord(parsed.cfg) ? parsed.cfg : {}),
      sound: typeof parsed.sound === "boolean" ? parsed.sound : true,
      vibe: typeof parsed.vibe === "boolean" ? parsed.vibe : true,
      awake: typeof parsed.awake === "boolean" ? parsed.awake : true,
    };
  } catch {
    return { cfg: { ...DEFAULT_SETTINGS }, sound: true, vibe: true, awake: true };
  }
}

export function savePersisted(storage: KeyValueStore, data: Persisted): boolean {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ cfg: data.cfg, sound: data.sound, vibe: data.vibe, awake: data.awake }));
    return true;
  } catch {
    return false;
  }
}

export function loadHints(storage: KeyValueStore): HintFlags {
  try {
    const raw = storage.getItem(HINTS_KEY);
    if (!raw) return { ...EMPTY_HINTS };
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return { ...EMPTY_HINTS };
    return {
      dismissedAudio: parsed.dismissedAudio === true,
      dismissedInstall: parsed.dismissedInstall === true,
    };
  } catch {
    return { ...EMPTY_HINTS };
  }
}

export function saveHints(storage: KeyValueStore, hints: HintFlags): boolean {
  try {
    storage.setItem(HINTS_KEY, JSON.stringify(hints));
    return true;
  } catch {
    return false;
  }
}
