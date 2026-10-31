import { describe, expect, it } from "vitest";
import { formatClock, formatCountdownMs, headerSubtitle, phaseHint, project, ringGeometry, selectView, tileClocks, timelineGap, wakeDescription } from "./display";
import { buildPlan, start, tick } from "./engine";
import { applyPreset, DEFAULT_SETTINGS, matchingPreset } from "./settings";
import { idleTimer } from "./engine";

describe("display", () => {
  it("formats clocks and countdown seconds", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(5)).toBe("0:05");
    expect(formatClock(240)).toBe("4:00");
    expect(formatClock(990)).toBe("16:30");
    expect(formatClock(2005)).toBe("33:25");
    expect(formatCountdownMs(17_000)).toBe("17");
    expect(formatCountdownMs(59_000)).toBe("59");
    expect(formatCountdownMs(59_001)).toBe("1:00");
    expect(formatCountdownMs(61_000)).toBe("1:01");
    expect(formatCountdownMs(1)).toBe("1");
    expect(formatCountdownMs(1000)).toBe("1");
    expect(formatCountdownMs(1001)).toBe("2");
  });

  it("drains the ring from full to empty", () => {
    const full = ringGeometry(20_000, 20_000);
    const half = ringGeometry(10_000, 20_000);
    const empty = ringGeometry(0, 20_000);
    expect(full.offset).toBe(0);
    expect(half.offset).toBeCloseTo(full.circumference / 2);
    expect(empty.offset).toBeCloseTo(full.circumference);
  });

  it("keeps elapsed and left adding up to the total", () => {
    const plan = buildPlan(DEFAULT_SETTINGS);
    const running = tick(start(DEFAULT_SETTINGS, 0).state, 15_000).state;
    const shot = project(running, 15_000);
    expect(shot.elapsedMs + shot.leftMs).toBe(shot.totalMs);
    expect(shot.totalMs).toBe(total(plan));
    const tiles = tileClocks(shot.elapsedMs, shot.totalMs);
    expect(tiles).toEqual({ elapsed: "0:15", left: "3:45", pct: 6 });
    expect(headerSubtitle(DEFAULT_SETTINGS, idleTimer())).toBe("4:00 total · 16 intervals");
    expect(headerSubtitle(DEFAULT_SETTINGS, running)).toBe("Round 1 of 8");
    expect(headerSubtitle(DEFAULT_SETTINGS, running)).not.toContain("Round 0");
  });

  it("names rounds and the next set", () => {
    const hiit = applyPreset(DEFAULT_SETTINGS, "hiit");
    const plan = buildPlan(hiit);
    const index = plan.findIndex((item) => item.type === "work" && item.set === 2 && item.round === 3);
    const state = { ...start(hiit, 0).state, index, endAt: 0, lastSec: 10 };
    expect(headerSubtitle(hiit, state)).toBe("Round 3 of 8 · Set 2 of 2");
    const rest = plan.findIndex((item) => item.type === "setRest");
    const setRest = { ...state, index: rest };
    expect(phaseHint(hiit, setRest)).toBe("Set 2 of 2 starts next");
    expect(timelineGap(plan.length)).toBe(2);
    expect(timelineGap(buildPlan(applyPreset(DEFAULT_SETTINGS, "endurance")).length)).toBe(0);
    expect(matchingPreset(DEFAULT_SETTINGS)).toBe("tabata");
    expect(matchingPreset({ ...DEFAULT_SETTINGS, work: 25 })).toBeNull();
    expect(wakeDescription(false)).toBe("Not supported on this browser");
  });

  it("shows finish on the last interval and the completed summary", () => {
    const done = tick(start({ ...DEFAULT_SETTINGS, prepare: 0, work: 5, rest: 0, rounds: 1, cool: 0, beeps: 0 }, 0).state, 5000).state;
    const view = selectView(DEFAULT_SETTINGS, done, 5000, true);
    expect(view.doneText).toContain("1 rounds of work");
    expect(view.showUpdate).toBe(false);
    const idle = selectView(DEFAULT_SETTINGS, idleTimer(), 0, true);
    expect(idle.showUpdate).toBe(true);
    expect(idle.totalText).toBe("4:00");
    expect(idle.presets.find((item) => item.id === "tabata")?.selected).toBe(true);
    const last = start(DEFAULT_SETTINGS, 0).state;
    const atLast = { ...last, index: last.plan.length - 1, endAt: 1_000_000, lastSec: 20 };
    expect(selectView(DEFAULT_SETTINGS, atLast, 1_000_000 - 10_000, false).nextText).toBe("Finish");
  });
});

function total(plan: { durationMs: number }[]): number {
  return plan.reduce((sum, item) => sum + item.durationMs, 0);
}
