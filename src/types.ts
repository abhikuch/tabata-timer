export type Phase = "prepare" | "work" | "rest" | "setRest" | "cool";

export type Status = "idle" | "running" | "paused" | "done";

export type Beeps = 0 | 3 | 5;

export const FIELD_KEYS = ["prepare", "work", "rest", "rounds", "sets", "setRest", "cool"] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

export interface Settings {
  prepare: number;
  work: number;
  rest: number;
  rounds: number;
  sets: number;
  setRest: number;
  cool: number;
  beeps: Beeps;
}

export interface Interval {
  type: Phase;
  durationMs: number;
  round: number;
  set: number;
}

export interface TimerState {
  status: Status;
  plan: Interval[];
  index: number;
  /** Wall-clock end of the current interval while running. */
  endAt: number | null;
  /** Exact remaining milliseconds while paused, and the full duration at the start of an interval. */
  remainingMs: number;
  /** Last second shown for this interval. -1 until the first tick. */
  lastSec: number;
  beeps: Beeps;
}

export type Cue =
  | { kind: "phase"; phase: Phase }
  | { kind: "countIn"; second: number }
  | { kind: "complete" };

export interface Result {
  state: TimerState;
  cues: Cue[];
}

export type PresetId = "tabata" | "beginner" | "hiit" | "endurance";
