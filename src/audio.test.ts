import { describe, expect, it, vi } from "vitest";
import { playCue, scheduleTone, tonePlan, vibrationPattern, type AudioBackend } from "./audio";
import type { Cue, Phase } from "./types";

const phases: Phase[] = ["prepare", "work", "rest", "setRest", "cool"];

describe("cue map", () => {
  it("uses the spec pitches and lengths", () => {
    expect(tonePlan({ kind: "phase", phase: "prepare" })).toEqual([{ freq: 660, ms: 200, when: 0 }]);
    expect(tonePlan({ kind: "phase", phase: "work" })).toEqual([{ freq: 1320, ms: 500, when: 0 }]);
    for (const phase of ["rest", "setRest", "cool"] as const) {
      expect(tonePlan({ kind: "phase", phase })).toEqual([{ freq: 587, ms: 500, when: 0 }]);
    }
    expect(tonePlan({ kind: "countIn", second: 2 })).toEqual([{ freq: 880, ms: 120, when: 0 }]);
    expect(tonePlan({ kind: "complete" })).toEqual([
      { freq: 1320, ms: 180, when: 0 },
      { freq: 1320, ms: 180, when: 0.25 },
      { freq: 1760, ms: 600, when: 0.5 },
    ]);
  });

  it("vibrates only where the spec asks", () => {
    expect(vibrationPattern({ kind: "phase", phase: "prepare" })).toBeNull();
    expect(vibrationPattern({ kind: "phase", phase: "work" })).toBe(400);
    expect(vibrationPattern({ kind: "phase", phase: "rest" })).toEqual([150, 80, 150]);
    expect(vibrationPattern({ kind: "phase", phase: "setRest" })).toEqual([150, 80, 150]);
    expect(vibrationPattern({ kind: "phase", phase: "cool" })).toEqual([150, 80, 150]);
    expect(vibrationPattern({ kind: "countIn", second: 1 })).toBeNull();
    expect(vibrationPattern({ kind: "complete" })).toEqual([300, 120, 300, 120, 600]);
    expect(phases).toHaveLength(5);
  });
});

describe("scheduleTone", () => {
  it("ramps the sine from silence to 0.4 and back without a zero gain", () => {
    const events: unknown[] = [];
    const osc = {
      type: "square" as OscillatorType,
      frequency: { value: 0 },
      connect: (node: unknown) => events.push(["osc-connect", node]),
      start: (when: number) => events.push(["start", when]),
      stop: (when: number) => events.push(["stop", when]),
    };
    const gain = {
      gain: {
        setValueAtTime: (value: number, time: number) => events.push(["set", value, time]),
        exponentialRampToValueAtTime: (value: number, time: number) => events.push(["exp", value, time]),
      },
      connect: (node: unknown) => events.push(["gain-connect", node]),
    };
    scheduleTone(osc, gain, "dest", { freq: 880, ms: 120, when: 0.25 }, 10);
    expect(osc.type).toBe("sine");
    expect(osc.frequency.value).toBe(880);
    expect(events.slice(0, 6)).toEqual([
      ["set", 0.0001, 10.25],
      ["exp", 0.4, 10.26],
      ["exp", 0.0001, 10.37],
      ["osc-connect", gain],
      ["gain-connect", "dest"],
      ["start", 10.25],
    ]);
    const stop = events[6] as [string, number];
    expect(stop[0]).toBe("stop");
    expect(stop[1]).toBeCloseTo(10.39, 10);
  });
});

function backend(): AudioBackend & { made: number; resumed: number } {
  const api = {
    currentTime: 4,
    made: 0,
    resumed: 0,
    resume() { api.resumed += 1; },
    createOscillator() {
      api.made += 1;
      return { type: "sine" as OscillatorType, frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
    },
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    },
    destination: {},
  };
  return api;
}

describe("playCue", () => {
  const cues: Cue[] = [
    { kind: "phase", phase: "work" },
    { kind: "phase", phase: "prepare" },
    { kind: "phase", phase: "rest" },
    { kind: "countIn", second: 3 },
    { kind: "complete" },
  ];

  it("keeps sound and vibration independent", () => {
    for (const cue of cues) {
      const heard = backend();
      const vibrate = vi.fn();
      playCue(cue, { sound: false, vibe: true }, heard, vibrate);
      expect(heard.made).toBe(0);
      const pattern = vibrationPattern(cue);
      if (pattern == null) expect(vibrate).not.toHaveBeenCalled();
      else expect(vibrate).toHaveBeenCalledWith(pattern);

      const silent = backend();
      const noBuzz = vi.fn();
      playCue(cue, { sound: true, vibe: false }, silent, noBuzz);
      expect(silent.made).toBe(tonePlan(cue).length);
      expect(silent.resumed).toBe(1);
      expect(noBuzz).not.toHaveBeenCalled();
    }
  });

  it("does not throw when audio or vibration fails", () => {
    const broken: AudioBackend = {
      currentTime: 0,
      resume() { throw new Error("interrupted"); },
      createOscillator() { throw new Error("no device"); },
      createGain() { throw new Error("no device"); },
      destination: {},
    };
    expect(() => playCue({ kind: "complete" }, { sound: true, vibe: true }, broken, () => { throw new Error("no vibe"); })).not.toThrow();
    expect(() => playCue({ kind: "phase", phase: "work" }, { sound: true, vibe: true }, null, undefined)).not.toThrow();
  });
});
