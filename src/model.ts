import { pause, resetTimer, resume, skipNext, skipPrevious, start, tick } from "./engine";
import { applyPreset, stepSetting } from "./settings";
import type { Persisted } from "./storage";
import type { Beeps, Cue, FieldKey, PresetId, Result, Settings, Status, TimerState } from "./types";

export interface Model {
  cfg: Settings;
  sound: boolean;
  vibe: boolean;
  awake: boolean;
  timer: TimerState;
  updateReady: boolean;
}

export type WakeEffect = "acquire" | "release" | "keep";

export interface Effect {
  cues: Cue[];
  wake: WakeEffect;
  persist: boolean;
  reload: boolean;
}

const NONE: Effect = { cues: [], wake: "keep", persist: false, reload: false };

export type Action =
  | { type: "tick"; now: number }
  | { type: "foreground"; now: number }
  | { type: "toggle"; now: number }
  | { type: "next"; now: number }
  | { type: "prev"; now: number }
  | { type: "reset" }
  | { type: "step"; key: FieldKey; dir: -1 | 1 }
  | { type: "preset"; id: PresetId }
  | { type: "sound"; on: boolean }
  | { type: "vibe"; on: boolean }
  | { type: "awake"; on: boolean }
  | { type: "beeps"; value: Beeps }
  | { type: "update-ready" }
  | { type: "reload" };

export interface ReduceResult {
  model: Model;
  effect: Effect;
}

export function createModel(persisted: Persisted): Model {
  return {
    cfg: persisted.cfg,
    sound: persisted.sound,
    vibe: persisted.vibe,
    awake: persisted.awake,
    timer: {
      status: "idle",
      plan: [],
      index: 0,
      endAt: null,
      remainingMs: 0,
      lastSec: -1,
      beeps: persisted.cfg.beeps,
    },
    updateReady: false,
  };
}

export function toPersisted(model: Model): Persisted {
  return { cfg: model.cfg, sound: model.sound, vibe: model.vibe, awake: model.awake };
}

function locked(status: Status): boolean {
  return status === "running" || status === "paused";
}

function wakeFor(before: Status, after: Status, awake: boolean, forceAcquire: boolean): WakeEffect {
  if (after === "running" && awake && (forceAcquire || before !== "running")) return "acquire";
  if (before === "running" && after !== "running") return "release";
  return "keep";
}

function commit(model: Model, result: Result, persist: boolean, forceAcquire = false): ReduceResult {
  const next = result.state === model.timer ? model : { ...model, timer: result.state };
  return {
    model: next,
    effect: {
      cues: result.cues,
      wake: wakeFor(model.timer.status, result.state.status, model.awake, forceAcquire),
      persist,
      reload: false,
    },
  };
}

export function reduce(model: Model, action: Action): ReduceResult {
  switch (action.type) {
    case "tick":
      return commit(model, tick(model.timer, action.now), false);
    case "foreground": {
      if (model.timer.status !== "running") return { model, effect: NONE };
      return commit(model, tick(model.timer, action.now), false, true);
    }
    case "toggle": {
      if (model.timer.status === "running") return commit(model, pause(model.timer, action.now), false);
      if (model.timer.status === "paused") return commit(model, resume(model.timer, action.now), false);
      return commit(model, start(model.cfg, action.now), false);
    }
    case "next":
      return commit(model, skipNext(model.timer, action.now), false);
    case "prev":
      return commit(model, skipPrevious(model.timer, action.now), false);
    case "reset": {
      if (model.timer.status === "idle") return { model, effect: NONE };
      return commit(model, { state: resetTimer(), cues: [] }, false);
    }
    case "step": {
      if (locked(model.timer.status)) return { model, effect: NONE };
      const cfg = stepSetting(model.cfg, action.key, action.dir);
      if (cfg === model.cfg) return { model, effect: NONE };
      return { model: { ...model, cfg }, effect: { ...NONE, persist: true } };
    }
    case "preset": {
      if (locked(model.timer.status)) return { model, effect: NONE };
      const cfg = applyPreset(model.cfg, action.id);
      if (cfg === model.cfg) return { model, effect: NONE };
      return { model: { ...model, cfg }, effect: { ...NONE, persist: true } };
    }
    case "sound":
      return setFlag(model, "sound", action.on);
    case "vibe":
      return setFlag(model, "vibe", action.on);
    case "awake":
      return setFlag(model, "awake", action.on);
    case "beeps": {
      if (locked(model.timer.status)) return { model, effect: NONE };
      if (model.cfg.beeps === action.value) return { model, effect: NONE };
      return { model: { ...model, cfg: { ...model.cfg, beeps: action.value } }, effect: { ...NONE, persist: true } };
    }
    case "update-ready":
      if (model.updateReady) return { model, effect: NONE };
      return { model: { ...model, updateReady: true }, effect: NONE };
    case "reload":
      if (model.timer.status !== "idle" || !model.updateReady) return { model, effect: NONE };
      return { model, effect: { ...NONE, reload: true } };
    default:
      return assertNever(action);
  }
}

function setFlag(model: Model, key: "sound" | "vibe" | "awake", on: boolean): ReduceResult {
  if (locked(model.timer.status)) return { model, effect: NONE };
  if (model[key] === on) return { model, effect: NONE };
  return { model: { ...model, [key]: on }, effect: { ...NONE, persist: true } };
}

function assertNever(value: never): never {
  throw new Error(`Unexpected action: ${String(value)}`);
}
