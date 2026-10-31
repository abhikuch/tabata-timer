import type { Beeps, FieldKey, Phase, PresetId, Settings } from "./types";
import { FIELD_KEYS } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  prepare: 10,
  work: 20,
  rest: 10,
  rounds: 8,
  sets: 1,
  setRest: 60,
  cool: 0,
  beeps: 3,
};

export interface FieldDef {
  key: FieldKey;
  label: string;
  hint: string;
  step: number;
  min: number;
  max: number;
  time: boolean;
  phase: Phase;
  icon: string;
}

export const FIELDS: readonly FieldDef[] = [
  {
    key: "prepare",
    label: "Get ready",
    hint: "Before the first round",
    step: 5,
    min: 0,
    max: 120,
    time: true,
    phase: "prepare",
    icon: "M6 3h12M6 21h12M7 3v3l5 6-5 6v3M17 3v3l-5 6 5 6v3",
  },
  {
    key: "work",
    label: "Work",
    hint: "Each round",
    step: 5,
    min: 5,
    max: 600,
    time: true,
    phase: "work",
    icon: "M13 2 4 14h7l-1 8 9-12h-7l1-8z",
  },
  {
    key: "rest",
    label: "Rest",
    hint: "Between rounds",
    step: 5,
    min: 0,
    max: 600,
    time: true,
    phase: "rest",
    icon: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM10 9v6M14 9v6",
  },
  {
    key: "rounds",
    label: "Rounds",
    hint: "Work and rest per set",
    step: 1,
    min: 1,
    max: 30,
    time: false,
    phase: "work",
    icon: "M17 2l3 3-3 3M3 11V9a4 4 0 0 1 4-4h13M7 22l-3-3 3-3M21 13v2a4 4 0 0 1-4 4H4",
  },
  {
    key: "sets",
    label: "Sets",
    hint: "Repeats of all rounds",
    step: 1,
    min: 1,
    max: 10,
    time: false,
    phase: "work",
    icon: "M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  },
  {
    key: "setRest",
    label: "Set rest",
    hint: "Between sets",
    step: 5,
    min: 0,
    max: 600,
    time: true,
    phase: "setRest",
    icon: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 7v5l3 2",
  },
  {
    key: "cool",
    label: "Cool down",
    hint: "After the last round",
    step: 15,
    min: 0,
    max: 900,
    time: true,
    phase: "cool",
    icon: "M2 12h20M12 2v20M5 5l14 14M19 5 5 19",
  },
];

export const PRESETS: readonly {
  id: PresetId;
  label: string;
  prepare: number;
  work: number;
  rest: number;
  rounds: number;
  sets: number;
  setRest: number;
  cool: number;
}[] = [
  { id: "tabata", label: "Tabata", prepare: 10, work: 20, rest: 10, rounds: 8, sets: 1, setRest: 60, cool: 0 },
  { id: "beginner", label: "Beginner", prepare: 10, work: 20, rest: 20, rounds: 6, sets: 1, setRest: 60, cool: 0 },
  { id: "hiit", label: "HIIT", prepare: 10, work: 40, rest: 20, rounds: 8, sets: 2, setRest: 60, cool: 0 },
  { id: "endurance", label: "Endurance", prepare: 10, work: 45, rest: 15, rounds: 10, sets: 3, setRest: 90, cool: 60 },
];

const BEEPS: readonly Beeps[] = [0, 3, 5];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n);
}

export function clampSettings(input: unknown): Settings {
  const src = isRecord(input) ? input : {};
  const next: Settings = { ...DEFAULT_SETTINGS };
  for (const field of FIELDS) {
    const raw = src[field.key];
    const n = raw === undefined ? next[field.key] : finiteInt(raw, next[field.key]);
    next[field.key] = Math.min(field.max, Math.max(field.min, n));
  }
  if (src.beeps !== undefined) {
    const beep = finiteInt(src.beeps, DEFAULT_SETTINGS.beeps);
    next.beeps = BEEPS.includes(beep as Beeps) ? (beep as Beeps) : DEFAULT_SETTINGS.beeps;
  }
  return next;
}

export function stepSetting(settings: Settings, key: FieldKey, direction: -1 | 1): Settings {
  const field = FIELDS.find((item) => item.key === key);
  if (!field) return settings;
  const value = Math.min(field.max, Math.max(field.min, settings[key] + direction * field.step));
  if (value === settings[key]) return settings;
  return { ...settings, [key]: value };
}

export function matchingPreset(settings: Settings): PresetId | null {
  for (const preset of PRESETS) {
    const same = FIELD_KEYS.every((key) => preset[key] === settings[key]);
    if (same) return preset.id;
  }
  return null;
}

export function applyPreset(settings: Settings, id: PresetId): Settings {
  const preset = PRESETS.find((item) => item.id === id);
  if (!preset) return settings;
  return {
    ...settings,
    prepare: preset.prepare,
    work: preset.work,
    rest: preset.rest,
    rounds: preset.rounds,
    sets: preset.sets,
    setRest: preset.setRest,
    cool: preset.cool,
  };
}
