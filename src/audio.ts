import { upcomingCues } from "./engine";
import type { Cue, Phase, TimerState } from "./types";

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
  armBackground?(timer: TimerState, now: number, flags: AudioFlags): void;
  /** Returns true when queued background beeps were still able to play. */
  disarmBackground?(): boolean;
  syncPlayback?(status: "idle" | "running" | "paused" | "done"): void;
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

export const PEAK_GAIN = 0.68;

export function scheduleTone(
  osc: OscNode,
  gain: GainNodeLike,
  destination: unknown,
  spec: ToneSpec,
  at: number,
  peak = PEAK_GAIN,
): { start: number; end: number } {
  const start = at + spec.when;
  const end = start + spec.ms / 1000;
  osc.type = "sine";
  osc.frequency.value = spec.freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain);
  const targets = Array.isArray(destination) ? destination : [destination];
  for (const target of targets) gain.connect(target);
  osc.start(start);
  osc.stop(end + 0.02);
  return { start, end };
}

export function playCue(
  cue: Cue,
  flags: AudioFlags,
  backend: AudioBackend | null,
  vibrate: ((pattern: number | number[]) => void) | undefined,
  at = backend?.currentTime ?? 0,
  destination: unknown = backend?.destination,
): void {
  if (flags.sound && backend && destination != null) {
    try {
      void Promise.resolve(backend.resume()).catch(() => undefined);
      for (const spec of tonePlan(cue)) {
        scheduleTone(backend.createOscillator(), backend.createGain(), destination, spec, at, PEAK_GAIN);
        scheduleTone(
          backend.createOscillator(),
          backend.createGain(),
          destination,
          { ...spec, freq: spec.freq * 2 },
          at,
          PEAK_GAIN * 0.36,
        );
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

type AudioContextCtor = new (options?: { latencyHint?: string }) => AudioBackend;

interface QueuedTone {
  osc: OscNode;
  start: number;
}

export function createAudio(factory?: () => AudioBackend | null): AudioSink {
  let backend: AudioBackend | null = null;
  let speaker: HTMLAudioElement | null = null;
  let streamDest: unknown = null;
  let sessionReady = false;
  let armed = false;
  let queued: QueuedTone[] = [];
  const make = factory ?? defaultFactory;

  const outputs = () => {
    const list: unknown[] = [];
    if (backend) list.push(backend.destination);
    if (streamDest) list.push(streamDest);
    return list.length === 1 ? list[0] : list;
  };

  const contextState = () => (backend && "state" in backend ? (backend as { state?: string }).state : undefined);

  const ensureSession = () => {
    if (!backend || sessionReady) return;
    sessionReady = true;
    const ctx = backend as AudioBackend & { createMediaStreamDestination?: () => { stream: MediaStream } };
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = "playback";
    if (ctx.createMediaStreamDestination) {
      const dest = ctx.createMediaStreamDestination();
      streamDest = dest;
      const element = new Audio();
      element.srcObject = dest.stream;
      element.setAttribute("playsinline", "");
      speaker = element;
    }
    const osc = backend.createOscillator();
    const gain = backend.createGain();
    osc.frequency.value = 28;
    gain.gain.setValueAtTime(0.001, backend.currentTime);
    osc.connect(gain);
    const target = outputs();
    const sinks = Array.isArray(target) ? target : [target];
    for (const sink of sinks) gain.connect(sink);
    osc.start(backend.currentTime);
  };

  const dropFuture = () => {
    const now = backend?.currentTime ?? 0;
    for (const tone of queued) {
      if (tone.start > now + 0.05) {
        try { tone.osc.stop(0); } catch { /* already stopped */ }
      }
    }
    queued = [];
    armed = false;
  };

  return {
    unlock() {
      try {
        if (!backend) backend = make();
        void Promise.resolve(backend?.resume()).catch(() => undefined);
        ensureSession();
        void speaker?.play().catch(() => undefined);
      } catch {
        backend = null;
      }
    },
    play(cue, flags) {
      if (!backend) return;
      playCue(
        cue,
        flags,
        backend,
        typeof navigator !== "undefined" ? navigator.vibrate?.bind(navigator) : undefined,
        backend.currentTime,
        outputs(),
      );
      const session = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
      if (session && cue.kind !== "countIn" && typeof MediaMetadata !== "undefined") {
        session.metadata = new MediaMetadata({ title: sessionTitle(cue), artist: "Tabata Timer" });
        session.playbackState = "playing";
      }
    },
    armBackground(timer, now, flags) {
      if (!backend || !flags.sound) return;
      dropFuture();
      void Promise.resolve(backend.resume()).catch(() => undefined);
      void speaker?.play().catch(() => undefined);
      const origin = backend.currentTime;
      const dest = outputs();
      for (const item of upcomingCues(timer, now)) {
        const at = origin + Math.max(0, item.at - now) / 1000;
        if (at <= origin) continue;
        for (const spec of tonePlan(item.cue)) {
          const voices = [
            { spec, peak: PEAK_GAIN },
            { spec: { ...spec, freq: spec.freq * 2 }, peak: PEAK_GAIN * 0.36 },
          ];
          for (const voice of voices) {
            const osc = backend.createOscillator();
            const timed = scheduleTone(osc, backend.createGain(), dest, voice.spec, at, voice.peak);
            queued.push({ osc, start: timed.start });
          }
        }
      }
      armed = queued.length > 0;
    },
    disarmBackground() {
      const heard = armed && contextState() === "running";
      dropFuture();
      return heard;
    },
    syncPlayback(status) {
      const session = typeof navigator !== "undefined" ? navigator.mediaSession : undefined;
      if (status === "running") {
        void speaker?.play().catch(() => undefined);
        if (session) session.playbackState = "playing";
        return;
      }
      dropFuture();
      speaker?.pause();
      if (session) session.playbackState = "paused";
    },
  };
}

function sessionTitle(cue: Cue): string {
  if (cue.kind === "complete") return "Workout complete";
  if (cue.kind === "countIn") return "Tabata";
  switch (cue.phase) {
    case "prepare":
      return "Get ready";
    case "work":
      return "Work";
    case "rest":
      return "Rest";
    case "setRest":
      return "Set rest";
    case "cool":
      return "Cool down";
    default:
      return assertNever(cue.phase);
  }
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
