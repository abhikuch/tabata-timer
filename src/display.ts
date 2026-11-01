import { displayedSecond, liveRemainingMs, totalMs } from "./engine";
import { buildPlan } from "./engine";
import { FIELDS, PRESETS, matchingPreset } from "./settings";
import type { Phase, Settings, TimerState } from "./types";

export const RING_RADIUS = 128;

export const PHASES: Record<Phase, { label: string; color: string }> = {
  prepare: { label: "Get ready", color: "var(--chart-3)" },
  work: { label: "Work", color: "var(--brand)" },
  rest: { label: "Rest", color: "var(--chart-4)" },
  setRest: { label: "Set rest", color: "var(--chart-2)" },
  cool: { label: "Cool down", color: "var(--chart-benchmark)" },
};

export function formatClock(totalSeconds: number): string {
  return String(Math.max(0, Math.round(totalSeconds)));
}

/** Whole seconds. Never minutes:seconds. */
export function formatSecondsLabel(seconds: number): string {
  return String(Math.max(0, Math.round(seconds)));
}

export function formatCountdownMs(ms: number): string {
  return formatSecondsLabel(Math.ceil(Math.max(0, ms) / 1000));
}

export function ringGeometry(remainingMs: number, durationMs: number): { circumference: number; offset: number } {
  const circumference = 2 * Math.PI * RING_RADIUS;
  const fraction = durationMs <= 0 ? 0 : Math.min(1, Math.max(0, remainingMs / durationMs));
  return { circumference, offset: circumference * (1 - fraction) };
}

export function timelineGap(count: number): number {
  return count <= 60 ? 2 : 0;
}

export function wakeDescription(supported: boolean): string {
  return supported ? "Screen stays on while the timer runs" : "Not supported on this browser";
}

export interface Projection {
  elapsedMs: number;
  leftMs: number;
  totalMs: number;
  remainingMs: number;
  fraction: number;
}

export function project(state: TimerState, now: number): Projection {
  const all = totalMs(state.plan);
  if (state.status === "done") {
    return { elapsedMs: all, leftMs: 0, totalMs: all, remainingMs: 0, fraction: 0 };
  }
  if (state.status === "idle" || state.plan.length === 0 || state.index < 0 || state.index >= state.plan.length) {
    return { elapsedMs: 0, leftMs: all, totalMs: all, remainingMs: 0, fraction: 1 };
  }
  const duration = state.plan[state.index].durationMs;
  const remaining = Math.max(0, Math.min(duration, liveRemainingMs(state, now)));
  let before = 0;
  for (let i = 0; i < state.index; i += 1) before += state.plan[i].durationMs;
  const elapsedMs = before + (duration - remaining);
  const leftMs = remaining + (all - before - duration);
  return {
    elapsedMs,
    leftMs,
    totalMs: all,
    remainingMs: remaining,
    fraction: duration <= 0 ? 0 : remaining / duration,
  };
}

export function tileClocks(elapsedMs: number, totalMsValue: number): { elapsed: string; left: string; pct: number } {
  const totalSec = Math.round(totalMsValue / 1000);
  const leftSec = Math.ceil(Math.max(0, totalMsValue - elapsedMs) / 1000);
  const elapsedSec = Math.max(0, totalSec - leftSec);
  const pct = totalMsValue <= 0 ? 0 : Math.round((elapsedMs / totalMsValue) * 100);
  return { elapsed: formatClock(elapsedSec), left: formatClock(leftSec), pct };
}

export function headerSubtitle(settings: Settings, state: TimerState): string {
  if (state.status === "idle" || state.plan.length === 0) {
    const plan = buildPlan(settings);
    return `${formatClock(totalMs(plan) / 1000)} total · ${plan.length} intervals`;
  }
  if (state.status === "done") {
    return `${formatClock(totalMs(state.plan) / 1000)} total · ${state.plan.length} intervals`;
  }
  const interval = state.plan[state.index];
  if (!interval) return "";
  if (interval.type === "prepare") return "Get ready";
  if (interval.type === "cool") return "Cool down";
  if (interval.type === "setRest") return `Set rest · Set ${interval.set} of ${settings.sets}`;
  const round = `Round ${interval.round} of ${settings.rounds}`;
  return settings.sets > 1 ? `${round} · Set ${interval.set} of ${settings.sets}` : round;
}

export function phaseHint(settings: Settings, state: TimerState): string {
  const interval = state.plan[state.index];
  if (!interval) return "";
  if (interval.type === "prepare") return `First up: work for ${formatClock(settings.work)}`;
  if (interval.type === "setRest") return `Set ${interval.set + 1} of ${settings.sets} starts next`;
  if (interval.type === "cool") return "All rounds done";
  const round = `Round ${interval.round} of ${settings.rounds}`;
  return settings.sets > 1 ? `${round} · Set ${interval.set} of ${settings.sets}` : round;
}

export function mainLabel(status: TimerState["status"]): string {
  if (status === "idle") return "Start workout";
  if (status === "done") return "Start again";
  if (status === "running") return "Pause";
  return "Resume";
}

export interface SetupFieldView {
  key: (typeof FIELDS)[number]["key"];
  label: string;
  hint: string;
  icon: string;
  tint: string;
  value: string;
  atMin: boolean;
  atMax: boolean;
  decLabel: string;
  incLabel: string;
}

export interface AppView {
  headerSub: string;
  paused: boolean;
  totalText: string;
  presets: { id: (typeof PRESETS)[number]["id"]; label: string; selected: boolean }[];
  fields: SetupFieldView[];
  showUpdate: boolean;
  phaseLabel: string;
  phaseColor: string;
  phaseHint: string;
  timerText: string;
  segOfText: string;
  ringC: number;
  ringOffset: number;
  timeline: { grow: number; color: string; opacity: number }[];
  timelineGap: number;
  intervalText: string;
  pctText: string;
  elapsedText: string;
  remainingText: string;
  nextText: string;
  nextColor: string;
  mainLabel: string;
  doneText: string;
  workText: string;
  worksCount: string;
}

export function selectView(
  settings: Settings,
  state: TimerState,
  now: number,
  updateReady: boolean,
): AppView {
  const idlePlan = state.status === "idle" ? buildPlan(settings) : state.plan;
  const totalText = formatClock(totalMs(idlePlan) / 1000);
  const selected = matchingPreset(settings);
  const shot = project(state.status === "idle" ? { ...state, plan: idlePlan, status: "idle" } : state, now);
  const clocks = tileClocks(state.status === "idle" ? 0 : shot.elapsedMs, shot.totalMs || totalMs(idlePlan));
  const interval = state.plan[state.index];
  const phase = interval ? PHASES[interval.type] : PHASES.work;
  const second = displayedSecond(state);
  const geometry = ringGeometry(
    state.status === "running" ? Math.max(0, liveRemainingMs(state, now)) : Math.max(0, state.remainingMs),
    interval?.durationMs ?? 1,
  );
  const next = state.plan[state.index + 1];
  const works = idlePlan.filter((item) => item.type === "work");
  const workMs = works.reduce((sum, item) => sum + item.durationMs, 0);

  return {
    headerSub: headerSubtitle(settings, state),
    paused: state.status === "paused",
    totalText,
    presets: PRESETS.map((preset) => ({ id: preset.id, label: preset.label, selected: selected === preset.id })),
    fields: FIELDS.map((field) => ({
      key: field.key,
      label: field.label,
      hint: field.hint,
      icon: field.icon,
      tint: PHASES[field.phase].color,
      value: field.time ? formatClock(settings[field.key]) : String(settings[field.key]),
      atMin: settings[field.key] <= field.min,
      atMax: settings[field.key] >= field.max,
      decLabel: `Decrease ${field.label}`,
      incLabel: `Increase ${field.label}`,
    })),
    showUpdate: updateReady && state.status === "idle",
    phaseLabel: interval ? phase.label : "",
    phaseColor: phase.color,
    phaseHint: phaseHint(settings, state),
    timerText: formatSecondsLabel(second),
    segOfText: interval ? `of ${formatClock(interval.durationMs / 1000)}` : "",
    ringC: geometry.circumference,
    ringOffset: geometry.offset,
    timeline: state.plan.map((item, index) => ({
      grow: item.durationMs,
      color: PHASES[item.type].color,
      opacity: state.status === "done" || index < state.index ? 1 : index === state.index ? 0.85 : 0.22,
    })),
    timelineGap: timelineGap(state.plan.length),
    intervalText: state.plan.length ? `Interval ${state.index + 1} of ${state.plan.length}` : "",
    pctText: `${clocks.pct}% done`,
    elapsedText: clocks.elapsed,
    remainingText: clocks.left,
    nextText: next ? `${PHASES[next.type].label} ${formatClock(next.durationMs / 1000)}` : "Finish",
    nextColor: next ? PHASES[next.type].color : "var(--ink)",
    mainLabel: mainLabel(state.status),
    doneText: `${works.length} rounds of work, ${formatClock(totalMs(idlePlan) / 1000)} in all.`,
    workText: formatClock(workMs / 1000),
    worksCount: String(works.length),
  };
}
