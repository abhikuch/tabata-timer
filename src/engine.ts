import type { Beeps, Cue, Interval, Phase, Result, Settings, TimerState } from "./types";

export function idleTimer(beeps: Beeps = 0): TimerState {
  return {
    status: "idle",
    plan: [],
    index: 0,
    endAt: null,
    remainingMs: 0,
    lastSec: -1,
    beeps,
  };
}

/**
 * Flat interval list. Zero-length slots are omitted.
 * The last round of the last set has no rest after it.
 * Between sets, Set rest is used when it is above 0; otherwise Rest is used.
 */
export function buildPlan(settings: Settings): Interval[] {
  const plan: Interval[] = [];
  const push = (type: Phase, seconds: number, round: number, set: number) => {
    if (seconds > 0) plan.push({ type, durationMs: seconds * 1000, round, set });
  };

  push("prepare", settings.prepare, 0, 1);
  for (let set = 1; set <= settings.sets; set += 1) {
    for (let round = 1; round <= settings.rounds; round += 1) {
      push("work", settings.work, round, set);
      const lastRound = round === settings.rounds;
      const lastSet = set === settings.sets;
      if (!lastRound) {
        push("rest", settings.rest, round, set);
      } else if (!lastSet) {
        if (settings.setRest > 0) push("setRest", settings.setRest, round, set);
        else push("rest", settings.rest, round, set);
      }
    }
  }
  push("cool", settings.cool, settings.rounds, settings.sets);
  return plan;
}

export function totalMs(plan: readonly Interval[]): number {
  let total = 0;
  for (const interval of plan) total += interval.durationMs;
  return total;
}

function doneState(state: TimerState): TimerState {
  return {
    ...state,
    status: "done",
    index: Math.max(0, state.plan.length - 1),
    endAt: null,
    remainingMs: 0,
    lastSec: -1,
  };
}

export function start(settings: Settings, now: number): Result {
  const plan = buildPlan(settings);
  const first = plan[0];
  if (!first) return { state: idleTimer(settings.beeps), cues: [] };
  return {
    state: {
      status: "running",
      plan,
      index: 0,
      endAt: now + first.durationMs,
      remainingMs: first.durationMs,
      lastSec: Math.ceil(first.durationMs / 1000),
      beeps: settings.beeps,
    },
    cues: [{ kind: "phase", phase: first.type }],
  };
}

/**
 * Catch the clock up to `now`. Time is `endAt - now`, never a decremented counter.
 * A late tick walks every missed boundary and emits one cue for the interval now current.
 * Count-in beeps are skipped on the same call as a phase change.
 * Repeated calls at the same timestamp do not emit a second cue.
 */
export function tick(state: TimerState, now: number): Result {
  if (state.status !== "running" || state.endAt == null) return { state, cues: [] };
  if (state.plan.length === 0 || state.index < 0 || state.index >= state.plan.length) {
    return { state: doneState(state), cues: [{ kind: "complete" }] };
  }

  let index = state.index;
  let endAt = state.endAt;
  let moved = false;

  while (endAt <= now) {
    index += 1;
    if (index >= state.plan.length) {
      return { state: doneState(state), cues: [{ kind: "complete" }] };
    }
    const duration = state.plan[index].durationMs;
    if (duration > 0) {
      endAt += duration;
      moved = true;
    }
  }

  const remainingMs = endAt - now;
  const sec = Math.ceil(remainingMs / 1000);
  const lastSec = moved ? -1 : state.lastSec;
  if (sec === lastSec) return { state, cues: [] };

  const cues: Cue[] = [];
  if (moved) {
    cues.push({ kind: "phase", phase: state.plan[index].type });
  } else if (lastSec !== -1 && sec > 0 && sec <= state.beeps) {
    cues.push({ kind: "countIn", second: sec });
  }

  return {
    state: { ...state, index, endAt, remainingMs, lastSec: sec },
    cues,
  };
}

/** Freeze the honest interval. If the current one has already ended, land on the next one first. */
export function pause(state: TimerState, now: number): Result {
  if (state.status !== "running") return { state, cues: [] };
  const caught = tick(state, now);
  if (caught.state.status !== "running" || caught.state.endAt == null) return caught;
  return {
    state: {
      ...caught.state,
      status: "paused",
      endAt: null,
      remainingMs: caught.state.endAt - now,
    },
    cues: caught.cues,
  };
}

export function resume(state: TimerState, now: number): Result {
  if (state.status !== "paused") return { state, cues: [] };
  const remainingMs = Math.max(0, state.remainingMs);
  return {
    state: {
      ...state,
      status: "running",
      endAt: now + remainingMs,
      remainingMs,
    },
    cues: [],
  };
}

/**
 * Move one interval forward from the interval on screen.
 * Does not catch up a stale clock: the foreground handler does that before a tap lands.
 */
export function skipNext(state: TimerState, now: number): Result {
  if (state.status !== "running" && state.status !== "paused") return { state, cues: [] };
  const index = state.index + 1;
  if (index >= state.plan.length) {
    return { state: doneState(state), cues: [{ kind: "complete" }] };
  }
  const duration = state.plan[index].durationMs;
  return {
    state: {
      ...state,
      index,
      remainingMs: duration,
      endAt: state.status === "running" ? now + duration : null,
      lastSec: Math.ceil(duration / 1000),
    },
    cues: [{ kind: "phase", phase: state.plan[index].type }],
  };
}

/**
 * More than 2s into the current interval restarts it. Otherwise go back one.
 * Elapsed time is capped at the interval length and ignores time spent paused.
 */
export function skipPrevious(state: TimerState, now: number): Result {
  if (state.status !== "running" && state.status !== "paused") return { state, cues: [] };
  const current = state.plan[state.index];
  if (!current) return { state, cues: [] };
  const rawRemaining = state.status === "running" && state.endAt != null ? state.endAt - now : state.remainingMs;
  const clampedRemaining = Math.max(0, Math.min(current.durationMs, rawRemaining));
  const elapsed = current.durationMs - clampedRemaining;
  let index = state.index;
  if (!(elapsed > 2000) && index > 0) index -= 1;
  const duration = state.plan[index].durationMs;
  const moved = index !== state.index;
  return {
    state: {
      ...state,
      index,
      remainingMs: duration,
      endAt: state.status === "running" ? now + duration : null,
      lastSec: Math.ceil(duration / 1000),
    },
    cues: moved ? [{ kind: "phase", phase: state.plan[index].type }] : [],
  };
}

export function resetTimer(): TimerState {
  return idleTimer();
}

export function displayedSecond(state: TimerState): number {
  if (state.status === "done" || state.status === "idle") return 0;
  if (state.status === "running" && state.lastSec >= 0) return state.lastSec;
  return Math.max(0, Math.ceil(Math.max(0, state.remainingMs) / 1000));
}

export function liveRemainingMs(state: TimerState, now: number): number {
  if (state.status === "running" && state.endAt != null) return state.endAt - now;
  return state.remainingMs;
}

export interface PlannedCue {
  at: number;
  cue: Cue;
}

/** Future beeps for a running workout. The opening second of an interval is omitted so it does not sit on the phase cue. */
export function upcomingCues(state: TimerState, now: number): PlannedCue[] {
  if (state.status !== "running" || state.endAt == null || state.plan.length === 0) return [];
  const cues: PlannedCue[] = [];
  let index = state.index;
  let endAt = state.endAt;

  const countIns = (intervalEnd: number, durationMs: number) => {
    const intervalStart = intervalEnd - durationMs;
    for (let sec = state.beeps; sec >= 1; sec -= 1) {
      const at = intervalEnd - sec * 1000;
      if (at <= intervalStart || at <= now) continue;
      cues.push({ at, cue: { kind: "countIn", second: sec } });
    }
  };

  countIns(endAt, state.plan[index].durationMs);
  for (let guard = 0; guard <= state.plan.length; guard += 1) {
    const next = index + 1;
    if (next >= state.plan.length) {
      if (endAt > now) cues.push({ at: endAt, cue: { kind: "complete" } });
      break;
    }
    if (endAt > now) cues.push({ at: endAt, cue: { kind: "phase", phase: state.plan[next].type } });
    index = next;
    endAt += state.plan[index].durationMs;
    countIns(endAt, state.plan[index].durationMs);
  }

  cues.sort((a, b) => a.at - b.at);
  return cues;
}
