import { describe, expect, it } from "vitest";
import { pause, resume, skipNext, skipPrevious, start, tick, totalMs } from "./engine";
import { clampSettings } from "./settings";
import type { Settings, TimerState } from "./types";

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSettings(rng: () => number): Settings {
  const step = (min: number, max: number, size: number) => min + size * Math.floor(rng() * ((max - min) / size + 1));
  const beeps = ([0, 3, 5] as const)[Math.floor(rng() * 3)];
  return clampSettings({
    prepare: rng() < 0.4 ? 0 : step(0, 20, 5),
    work: step(5, 20, 5),
    rest: rng() < 0.35 ? 0 : step(5, 15, 5),
    rounds: 1 + Math.floor(rng() * 4),
    sets: 1 + Math.floor(rng() * 3),
    setRest: rng() < 0.35 ? 0 : step(0, 20, 5),
    cool: rng() < 0.5 ? 0 : step(15, 30, 15),
    beeps,
  });
}

function position(state: TimerState, now: number): number {
  const total = totalMs(state.plan);
  if (state.status === "done" || state.status === "idle") return state.status === "done" ? total : 0;
  let before = 0;
  for (let i = 0; i < state.index; i += 1) before += state.plan[i].durationMs;
  const duration = state.plan[state.index].durationMs;
  const remaining = state.status === "running" && state.endAt != null ? state.endAt - now : state.remainingMs;
  return before + (duration - remaining);
}

function boundaries(state: TimerState): number[] {
  const marks = [0];
  let sum = 0;
  for (const interval of state.plan) {
    sum += interval.durationMs;
    marks.push(sum);
  }
  return marks;
}

describe("timer fuzz", () => {
  it("holds the wall-clock invariant across random workouts", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const rng = mulberry32(seed);
      const settings = randomSettings(rng);
      const total = totalMs(start(settings, 0).state.plan);
      let state = start(settings, 0).state;
      let now = 0;
      expect(start(settings, 0).cues).toHaveLength(1);
      for (let op = 0; op < 80 && state.status !== "done"; op += 1) {
        const roll = rng();
        if (state.status === "running") {
          if (roll < 0.55) {
            const dt = 1 + Math.floor(rng() * 8000);
            const before = position(state, now);
            const result = tick(state, now + dt);
            expect(result.cues.length, `seed ${seed} op ${op}`).toBeLessThanOrEqual(1);
            state = result.state;
            now += dt;
            expect(position(state, now), `seed ${seed} advance`).toBe(Math.min(total, before + dt));
          } else if (roll < 0.7) {
            const before = position(state, now);
            const result = pause(state, now);
            expect(result.cues.length).toBeLessThanOrEqual(1);
            state = result.state;
            if (state.status === "paused") expect(position(state, now + 50_000)).toBe(before);
          } else if (roll < 0.85) {
            const result = skipNext(state, now);
            expect(result.cues).toHaveLength(1);
            state = result.state;
            expect(boundaries(state)).toContain(position(state, now));
          } else {
            const result = skipPrevious(state, now);
            expect(result.cues.length).toBeLessThanOrEqual(1);
            state = result.state;
            expect(boundaries(state)).toContain(position(state, now));
          }
        } else if (state.status === "paused") {
          const before = position(state, now);
          if (roll < 0.5) {
            now += 1 + Math.floor(rng() * 30_000);
            const result = resume(state, now);
            expect(result.cues).toEqual([]);
            state = result.state;
            expect(position(state, now)).toBe(before);
          } else if (roll < 0.75) {
            state = skipNext(state, now).state;
            expect(boundaries(state)).toContain(position(state, now));
          } else {
            state = skipPrevious(state, now).state;
            expect(boundaries(state)).toContain(position(state, now));
          }
        }
        if (state.status === "running") {
          expect(state.endAt).not.toBeNull();
          expect(state.endAt! - now).toBeGreaterThan(0);
          expect(state.index).toBeGreaterThanOrEqual(0);
          expect(state.index).toBeLessThan(state.plan.length);
        }
        if (state.status === "paused") {
          expect(state.endAt).toBeNull();
          expect(state.remainingMs).toBeGreaterThan(0);
          expect(state.remainingMs).toBeLessThanOrEqual(state.plan[state.index].durationMs);
        }
      }
    }
  });
});
