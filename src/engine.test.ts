import { describe, expect, it } from "vitest";
import { buildPlan, displayedSecond, liveRemainingMs, pause, resetTimer, resume, skipNext, skipPrevious, start, tick, totalMs } from "./engine";
import { DEFAULT_SETTINGS } from "./settings";
import type { Interval, Settings, TimerState } from "./types";

const TABATA = DEFAULT_SETTINGS;

function seconds(plan: Interval[]): number {
  return totalMs(plan) / 1000;
}

function expectedTotal(s: Settings): number {
  const prepare = s.prepare > 0 ? s.prepare : 0;
  const cool = s.cool > 0 ? s.cool : 0;
  const betweenRounds = s.rest > 0 ? (s.rounds - 1) * s.rest : 0;
  const perSet = s.rounds * s.work + betweenRounds;
  const gap = s.setRest > 0 ? s.setRest : s.rest > 0 ? s.rest : 0;
  const betweenSets = s.sets > 1 ? (s.sets - 1) * gap : 0;
  return prepare + s.sets * perSet + betweenSets + cool;
}

function walkStructure(s: Settings, plan: Interval[]) {
  let i = 0;
  if (s.prepare > 0) {
    expect(plan[i]).toMatchObject({ type: "prepare", durationMs: s.prepare * 1000, round: 0 });
    i += 1;
  }
  for (let set = 1; set <= s.sets; set += 1) {
    for (let round = 1; round <= s.rounds; round += 1) {
      expect(plan[i]).toMatchObject({ type: "work", durationMs: s.work * 1000, round, set });
      i += 1;
      const lastRound = round === s.rounds;
      const lastSet = set === s.sets;
      if (!lastRound && s.rest > 0) {
        expect(plan[i]).toMatchObject({ type: "rest", durationMs: s.rest * 1000, round, set });
        i += 1;
      } else if (lastRound && !lastSet) {
        if (s.setRest > 0) {
          expect(plan[i]).toMatchObject({ type: "setRest", durationMs: s.setRest * 1000, round, set });
          i += 1;
        } else if (s.rest > 0) {
          expect(plan[i]).toMatchObject({ type: "rest", durationMs: s.rest * 1000, round, set });
          i += 1;
        }
      }
    }
  }
  if (s.cool > 0) {
    expect(plan[i]).toMatchObject({ type: "cool", durationMs: s.cool * 1000 });
    i += 1;
  }
  expect(i).toBe(plan.length);
  expect(plan.every((item) => item.durationMs > 0)).toBe(true);
  expect(plan.filter((item) => item.type === "work")).toHaveLength(s.rounds * s.sets);
}

describe("buildPlan", () => {
  it("builds classic Tabata as 4:00 and 16 intervals", () => {
    const plan = buildPlan(TABATA);
    expect(seconds(plan)).toBe(240);
    expect(plan).toHaveLength(16);
    expect(plan.map((item) => item.type)).toEqual([
      "prepare",
      "work", "rest", "work", "rest", "work", "rest", "work", "rest",
      "work", "rest", "work", "rest", "work", "rest", "work",
    ]);
  });

  it("matches the preset totals from the spec", () => {
    expect(seconds(buildPlan({ ...TABATA, work: 20, rest: 20, rounds: 6 }))).toBe(230);
    expect(seconds(buildPlan({ ...TABATA, work: 40, rest: 20, rounds: 8, sets: 2, setRest: 60 }))).toBe(990);
    expect(seconds(buildPlan({ ...TABATA, work: 45, rest: 15, rounds: 10, sets: 3, setRest: 90, cool: 60 }))).toBe(2005);
  });

  it("skips rest when rest is 0 and cues would be back-to-back work", () => {
    const plan = buildPlan({ ...TABATA, prepare: 0, rest: 0, rounds: 3, sets: 1, cool: 0 });
    expect(plan.map((item) => item.type)).toEqual(["work", "work", "work"]);
  });

  it("uses rest between sets when set rest is 0", () => {
    const plan = buildPlan({ ...TABATA, prepare: 0, work: 20, rest: 10, rounds: 2, sets: 2, setRest: 0, cool: 0 });
    expect(plan.map((item) => item.type)).toEqual(["work", "rest", "work", "rest", "work", "rest", "work"]);
  });

  it("leaves no gap when rest and set rest are both 0", () => {
    const plan = buildPlan({ ...TABATA, prepare: 0, rest: 0, rounds: 2, sets: 2, setRest: 0, cool: 0 });
    expect(plan.map((item) => item.type)).toEqual(["work", "work", "work", "work"]);
  });

  it("is get ready, work, and cool down for a single round", () => {
    const plan = buildPlan({ ...TABATA, rounds: 1, sets: 1, cool: 15 });
    expect(plan.map((item) => item.type)).toEqual(["prepare", "work", "cool"]);
  });

  it("matches an independent total and structure on a grid of settings", () => {
    const prep = [0, 10, 120];
    const work = [5, 20, 600];
    const rest = [0, 10, 600];
    const rounds = [1, 8, 30];
    const sets = [1, 2, 10];
    const setRest = [0, 60, 600];
    const cool = [0, 60, 900];
    for (const prepare of prep) {
      for (const w of work) {
        for (const r of rest) {
          for (const round of rounds) {
            for (const set of sets) {
              for (const gap of setRest) {
                for (const down of cool) {
                  const settings = { ...TABATA, prepare, work: w, rest: r, rounds: round, sets: set, setRest: gap, cool: down };
                  const plan = buildPlan(settings);
                  expect(seconds(plan)).toBe(expectedTotal(settings));
                  walkStructure(settings, plan);
                }
              }
            }
          }
        }
      }
    }
  });
});

describe("wall clock", () => {
  const starts = [0, 1, 50, 999, 1000, 42, 86_400_000, 1_700_000_000_000, 1_700_000_000_001, 123456789];

  it.each(starts)("finishes default Tabata at exactly 4:00 from %s", (t0) => {
    let state = start(TABATA, t0).state;
    const early = tick(state, t0 + 240_000 - 1);
    expect(early.state.status).toBe("running");
    state = early.state;
    const done = tick(state, t0 + 240_000);
    expect(done.state.status).toBe("done");
    expect(done.cues).toEqual([{ kind: "complete" }]);
    const again = tick(done.state, t0 + 240_000 + 5000);
    expect(again.cues).toEqual([]);
    expect(again.state).toBe(done.state);
  });

  it("keeps the overshoot instead of restarting the next interval from now", () => {
    const settings = { ...TABATA, prepare: 0, work: 1, rest: 1, rounds: 2, sets: 1, cool: 0 };
    let state = start(settings, 0).state;
    const landed = tick(state, 1300);
    expect(landed.state.index).toBe(1);
    expect(landed.state.endAt).toBe(2000);
    expect(landed.state.endAt! - 1300).toBe(700);
    expect(landed.cues).toEqual([{ kind: "phase", phase: "rest" }]);
  });

  it("crosses several intervals in one tick and plays only the current cue", () => {
    const opened = start(TABATA, 10_000);
    const jumped = tick(opened.state, 10_000 + 45_000);
    expect(jumped.state.plan[jumped.state.index]).toMatchObject({ type: "work", round: 2 });
    expect(jumped.state.endAt! - (10_000 + 45_000)).toBe(15_000);
    expect(jumped.cues).toEqual([{ kind: "phase", phase: "work" }]);
    const again = tick(jumped.state, 10_000 + 45_000);
    expect(again.cues).toEqual([]);
    expect(again.state).toBe(jumped.state);
  });

  it("lands on the correct interval after a 45s gap mid-workout", () => {
    let state = start(TABATA, 0).state;
    state = tick(state, 15_000).state;
    expect(state.plan[state.index]).toMatchObject({ type: "work", round: 1 });
    const back = tick(state, 60_000);
    expect(back.state.plan[back.state.index]).toMatchObject({ type: "rest", round: 2 });
    expect(back.state.endAt! - 60_000).toBe(10_000);
    expect(back.cues).toEqual([{ kind: "phase", phase: "rest" }]);
  });

  it("does not drift across a 30 minute workout with 5 pauses", () => {
    const settings: Settings = { ...TABATA, prepare: 0, work: 60, rest: 0, rounds: 30, sets: 1, setRest: 0, cool: 0, beeps: 3 };
    const total = 1_800_000;
    let state = start(settings, 0).state;
    let now = 0;
    const marks = [200_000, 600_000, 900_000, 1_200_000, 1_500_000];
    let ran = 0;
    for (const mark of marks) {
      now += mark - ran;
      state = tick(state, now).state;
      expect(state.status).toBe("running");
      const paused = pause(state, now);
      expect(paused.state.status).toBe("paused");
      const frozen = paused.state.remainingMs;
      now += 60_000;
      const resumed = resume(paused.state, now);
      expect(resumed.cues).toEqual([]);
      expect(resumed.state.endAt).toBe(now + frozen);
      state = resumed.state;
      ran = mark;
    }
    const finishAt = now + (total - ran);
    expect(tick(state, finishAt - 1).state.status).toBe("running");
    const done = tick(state, finishAt);
    expect(done.state.status).toBe("done");
    expect(done.cues).toEqual([{ kind: "complete" }]);
  });

  it("stays exact when ticks are irregular", () => {
    const total = totalMs(buildPlan(TABATA));
    let state = start(TABATA, 0).state;
    let now = 0;
    let guard = 0;
    while (state.status === "running" && guard < 5000) {
      const step = 37 + ((guard * 91) % 400);
      const next = Math.min(total, now + step);
      const before = position(state, now);
      const result = tick(state, next);
      state = result.state;
      expect(position(state, next)).toBe(Math.min(total, before + (next - now)));
      now = next;
      guard += 1;
    }
    expect(state.status).toBe("done");
    expect(now).toBe(total);
  });

  it("walks the first 40s of Tabata on a 100ms grid with the right cues", () => {
    const events: { t: number; cues: TimerState extends never ? never : unknown }[] = [];
    const opened = start(TABATA, 0);
    events.push({ t: 0, cues: opened.cues });
    let state = opened.state;
    for (let t = 100; t <= 40_000; t += 100) {
      const result = tick(state, t);
      state = result.state;
      if (state.status === "running") {
        expect(displayedSecond(state)).toBe(Math.ceil((state.endAt! - t) / 1000));
        expect(displayedSecond(state)).toBeGreaterThanOrEqual(1);
      }
      if (result.cues.length) events.push({ t, cues: result.cues });
      expect(result.cues.length).toBeLessThanOrEqual(1);
      expect(result.cues.some((cue) => cue.kind === "phase") && result.cues.some((cue) => cue.kind === "countIn")).toBe(false);
    }
    expect(events).toEqual([
      { t: 0, cues: [{ kind: "phase", phase: "prepare" }] },
      { t: 7000, cues: [{ kind: "countIn", second: 3 }] },
      { t: 8000, cues: [{ kind: "countIn", second: 2 }] },
      { t: 9000, cues: [{ kind: "countIn", second: 1 }] },
      { t: 10000, cues: [{ kind: "phase", phase: "work" }] },
      { t: 27000, cues: [{ kind: "countIn", second: 3 }] },
      { t: 28000, cues: [{ kind: "countIn", second: 2 }] },
      { t: 29000, cues: [{ kind: "countIn", second: 1 }] },
      { t: 30000, cues: [{ kind: "phase", phase: "rest" }] },
      { t: 37000, cues: [{ kind: "countIn", second: 3 }] },
      { t: 38000, cues: [{ kind: "countIn", second: 2 }] },
      { t: 39000, cues: [{ kind: "countIn", second: 1 }] },
      { t: 40000, cues: [{ kind: "phase", phase: "work" }] },
    ]);
  });

  it("does not beep the second that coincides with a phase cue", () => {
    const settings: Settings = { ...TABATA, prepare: 0, work: 5, rest: 0, rounds: 1, sets: 1, cool: 0, beeps: 5 };
    const cues = [start(settings, 0).cues];
    let state = start(settings, 0).state;
    for (let t = 1000; t <= 5000; t += 1000) {
      const result = tick(state, t);
      state = result.state;
      if (result.cues.length) cues.push(result.cues);
    }
    expect(cues).toEqual([
      [{ kind: "phase", phase: "work" }],
      [{ kind: "countIn", second: 4 }],
      [{ kind: "countIn", second: 3 }],
      [{ kind: "countIn", second: 2 }],
      [{ kind: "countIn", second: 1 }],
      [{ kind: "complete" }],
    ]);
  });

  it("plays a work cue for every back-to-back work interval", () => {
    const settings: Settings = { ...TABATA, prepare: 0, rest: 0, rounds: 3, sets: 1, cool: 0, work: 5, beeps: 0 };
    let state = start(settings, 0).state;
    expect(start(settings, 0).cues).toEqual([{ kind: "phase", phase: "work" }]);
    expect(tick(state, 5000).cues).toEqual([{ kind: "phase", phase: "work" }]);
    state = tick(state, 5000).state;
    expect(tick(state, 10000).cues).toEqual([{ kind: "phase", phase: "work" }]);
    state = tick(state, 10000).state;
    expect(tick(state, 15000)).toMatchObject({ state: { status: "done" }, cues: [{ kind: "complete" }] });
  });

  it("skips zero-duration slots without hanging", () => {
    const state: TimerState = {
      status: "running",
      plan: [
        { type: "work", durationMs: 1000, round: 1, set: 1 },
        { type: "rest", durationMs: 0, round: 1, set: 1 },
        { type: "work", durationMs: 5000, round: 2, set: 1 },
      ],
      index: 0,
      endAt: 1000,
      remainingMs: 1000,
      lastSec: 1,
      beeps: 3,
    };
    const result = tick(state, 1000);
    expect(result.state.index).toBe(2);
    expect(result.state.endAt).toBe(6000);
    expect(result.cues).toEqual([{ kind: "phase", phase: "work" }]);
  });
});

describe("pause, resume, skip", () => {
  it("keeps remaining time to the millisecond across pause and resume", () => {
    let state = start(TABATA, 0).state;
    state = tick(state, 100).state;
    const paused = pause(state, 500);
    expect(paused.cues).toEqual([]);
    expect(paused.state.remainingMs).toBe(9500);
    expect(paused.state.endAt).toBeNull();
    const resumed = resume(paused.state, 20_000);
    expect(resumed.cues).toEqual([]);
    expect(resumed.state.endAt).toBe(29_500);
    const later = tick(resumed.state, 21_000);
    expect(later.state.endAt! - 21_000).toBe(8500);
  });

  it("does not count wall time while paused, including previous", () => {
    let state = skipNext(start(TABATA, 0).state, 0).state;
    state = pause(state, 0).state;
    const back = skipPrevious(state, 10_000);
    expect(back.state.index).toBe(0);
    expect(back.cues).toEqual([{ kind: "phase", phase: "prepare" }]);
  });

  it("catches up when pause happens after the interval has ended", () => {
    const running = start(TABATA, 0).state;
    const paused = pause(running, 10_000);
    expect(paused.state.status).toBe("paused");
    expect(paused.state.plan[paused.state.index].type).toBe("work");
    expect(paused.state.remainingMs).toBe(20_000);
    expect(paused.cues).toEqual([{ kind: "phase", phase: "work" }]);
  });

  it("finishes instead of pausing when the whole workout is already over", () => {
    const running = start({ ...TABATA, prepare: 0, work: 5, rest: 0, rounds: 1, cool: 0, beeps: 0 }, 0).state;
    const paused = pause(running, 5_000);
    expect(paused.state.status).toBe("done");
    expect(paused.cues).toEqual([{ kind: "complete" }]);
  });

  it("does not re-beep the same count-in second after resume", () => {
    let state = start({ ...TABATA, prepare: 10, beeps: 3 }, 0).state;
    state = tick(state, 100).state;
    state = tick(state, 7000).state;
    expect(tick(state, 7000).cues).toEqual([]);
    const paused = pause(state, 7500);
    const resumed = resume(paused.state, 20_000);
    expect(tick(resumed.state, 20_000).cues).toEqual([]);
    expect(tick(resumed.state, 21_000).cues).toEqual([{ kind: "countIn", second: 2 }]);
  });

  it("goes to complete from next on the last interval", () => {
    const settings = { ...TABATA, prepare: 0, work: 5, rest: 0, rounds: 1, cool: 0 };
    const running = start(settings, 0).state;
    const done = skipNext(running, 1000);
    expect(done.state.status).toBe("done");
    expect(done.cues).toEqual([{ kind: "complete" }]);
    expect(skipNext(done.state, 2000).cues).toEqual([]);
  });

  it("restarts interval 1 during its first 2 seconds", () => {
    const running = start(TABATA, 0).state;
    const early = skipPrevious(tick(running, 1500).state, 1500);
    expect(early.state.index).toBe(0);
    expect(early.cues).toEqual([]);
    expect(early.state.endAt).toBe(1500 + 10_000);
    const later = skipPrevious(tick(start(TABATA, 0).state, 5000).state, 5000);
    expect(later.state.index).toBe(0);
    expect(later.cues).toEqual([]);
  });

  it("goes back at exactly 2s and restarts after more than 2s", () => {
    const atTwo = tick(start(TABATA, 0).state, 12_000);
    const back = skipPrevious(atTwo.state, 12_000);
    expect(back.state.index).toBe(0);
    expect(back.cues).toEqual([{ kind: "phase", phase: "prepare" }]);
    const justOver = tick(start(TABATA, 0).state, 12_001);
    const restart = skipPrevious(justOver.state, 12_001);
    expect(restart.state.index).toBe(1);
    expect(restart.cues).toEqual([]);
    expect(restart.state.endAt).toBe(12_001 + 20_000);
  });

  it("next from a stale index moves only one interval", () => {
    const running = start(TABATA, 0).state;
    const jumped = skipNext(running, 45_000);
    expect(jumped.state.index).toBe(1);
    expect(jumped.state.endAt).toBe(45_000 + 20_000);
    expect(jumped.cues).toEqual([{ kind: "phase", phase: "work" }]);
  });

  it("reset drops progress and does not emit a cue", () => {
    expect(resetTimer().status).toBe("idle");
    expect(resume({ ...start(TABATA, 0).state, status: "idle" }, 5).cues).toEqual([]);
  });
});

function position(state: TimerState, now: number): number {
  const total = totalMs(state.plan);
  if (state.status === "done") return total;
  let before = 0;
  for (let i = 0; i < state.index; i += 1) before += state.plan[i].durationMs;
  const duration = state.plan[state.index].durationMs;
  const remaining = state.status === "running" && state.endAt != null ? state.endAt - now : state.remainingMs;
  return before + (duration - remaining);
}

void liveRemainingMs;
