import type { Cue, Phase } from "./types";

export interface AudioFlags {
  sound: boolean;
  vibe: boolean;
}

export interface ToneSpec {
  freq: number;
  ms: number;
  when: number;
}

interface GainParam {
  setValueAtTime(value: number, time: number): void;
  exponentialRampToValueAtTime(value: number, time: number): void;
}

interface OscNode {
  type: OscillatorType;
  frequency: { value: number };
  connect(node: unknown): void;
  start(when: number): void;
  stop(when: number): void;
}

interface GainNodeLike {
  gain: GainParam;
  connect(node: unknown): void;
}

export interface AudioBackend {
  currentTime: number;
  resume(): void | Promise<void>;
  createOscillator(): OscNode;
  createGain(): GainNodeLike;
  destination: unknown;
}

export interface AudioSink {
  unlock(): void;
  play(cue: Cue, flags: AudioFlags): void;
}

export function tonePlan(cue: Cue): ToneSpec[] {
  switch (cue.kind) {
    case "countIn":
      return [{ freq: 880, ms: 120, when: 0 }];
    case "complete":
      return [
        { freq: 1320, ms: 180, when: 0 },
        { freq: 1320, ms: 180, when: 0.25 },
        { freq: 1760, ms: 600, when: 0.5 },
      ];
    case "phase":
      return [phaseTone(cue.phase)];
    default:
      return assertNever(cue);
  }
}

function phaseTone(phase: Phase): ToneSpec {
  switch (phase) {
    case "work":
      return { freq: 1320, ms: 500, when: 0 };
    case "prepare":
      return { freq: 660, ms: 200, when: 0 };
    case "rest":
    case "setRest":
    case "cool":
      return { freq: 587, ms: 500, when: 0 };
    default:
      return assertNever(phase);
  }
}

export function vibrationPattern(cue: Cue): number | number[] | null {
  switch (cue.kind) {
    case "countIn":
      return null;
    case "complete":
      return [300, 120, 300, 120, 600];
    case "phase":
      return phaseVibration(cue.phase);
    default:
      return assertNever(cue);
  }
}

function phaseVibration(phase: Phase): number | number[] | null {
  switch (phase) {
    case "work":
      return 400;
    case "prepare":
      return null;
    case "rest":
    case "setRest":
    case "cool":
      return [150, 80, 150];
    default:
      return assertNever(phase);
  }
}

export function scheduleTone(osc: OscNode, gain: GainNodeLike, destination: unknown, spec: ToneSpec, at: number): void {
  const start = at + spec.when;
  const end = start + spec.ms / 1000;
  osc.type = "sine";
  osc.frequency.value = spec.freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.4, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(start);
  osc.stop(end + 0.02);
}

export function playCue(cue: Cue, flags: AudioFlags, backend: AudioBackend | null, vibrate: ((pattern: number | number[]) => void) | undefined): void {
  if (flags.sound && backend) {
    try {
      void Promise.resolve(backend.resume()).catch(() => undefined);
      const at = backend.currentTime;
      for (const spec of tonePlan(cue)) {
        scheduleTone(backend.createOscillator(), backend.createGain(), backend.destination, spec, at);
      }
    } catch {
      /* a failed cue must not stop the clock */
    }
  }
  if (!flags.vibe || !vibrate) return;
  const pattern = vibrationPattern(cue);
  if (pattern == null) return;
  try {
    vibrate(pattern);
  } catch {
    /* vibration is optional */
  }
}

type AudioContextCtor = new () => AudioBackend;

export function createAudio(factory?: () => AudioBackend | null): AudioSink {
  let backend: AudioBackend | null = null;
  const make = factory ?? defaultFactory;
  return {
    unlock() {
      try {
        if (!backend) backend = make();
        if (backend && "state" in backend && (backend as { state?: string }).state === "suspended") {
          void Promise.resolve(backend.resume()).catch(() => undefined);
        } else {
          void Promise.resolve(backend?.resume()).catch(() => undefined);
        }
      } catch {
        backend = null;
      }
    },
    play(cue, flags) {
      playCue(cue, flags, backend, typeof navigator !== "undefined" ? navigator.vibrate?.bind(navigator) : undefined);
    },
  };
}

function defaultFactory(): AudioBackend | null {
  if (typeof window === "undefined") return null;
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctx) return null;
  return new Ctx();
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
