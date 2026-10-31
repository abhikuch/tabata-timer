import { describe, expect, it } from "vitest";
import { createModel, reduce } from "./model";
import { DEFAULT_SETTINGS } from "./settings";
import { DEFAULT_PERSISTED } from "./storage";

const base = () => createModel(DEFAULT_PERSISTED);

describe("reducer", () => {
  it("starts, pauses on the boundary, and resumes without a second cue", () => {
    const started = reduce(base(), { type: "toggle", now: 0 });
    expect(started.model.timer.status).toBe("running");
    expect(started.effect.cues).toEqual([{ kind: "phase", phase: "prepare" }]);
    expect(started.effect.wake).toBe("acquire");
    const paused = reduce(started.model, { type: "toggle", now: 10_000 });
    expect(paused.model.timer.status).toBe("paused");
    expect(paused.model.timer.plan[paused.model.timer.index].type).toBe("work");
    expect(paused.effect.cues).toEqual([{ kind: "phase", phase: "work" }]);
    expect(paused.effect.wake).toBe("release");
    const resumed = reduce(paused.model, { type: "toggle", now: 50_000 });
    expect(resumed.model.timer.endAt).toBe(70_000);
    expect(resumed.effect.cues).toEqual([]);
    expect(resumed.effect.wake).toBe("acquire");
  });

  it("catches a hidden workout up on foreground and can finish it", () => {
    const started = reduce(base(), { type: "toggle", now: 1_000_000 });
    const back = reduce(started.model, { type: "foreground", now: 1_045_000 });
    expect(back.model.timer.plan[back.model.timer.index]).toMatchObject({ type: "work", round: 2 });
    expect(back.effect.wake).toBe("acquire");
    expect(back.effect.cues).toEqual([{ kind: "phase", phase: "work" }]);
    const late = reduce(started.model, { type: "foreground", now: 1_000_000 + 240_000 });
    expect(late.model.timer.status).toBe("done");
    expect(late.effect.cues).toEqual([{ kind: "complete" }]);
    expect(late.effect.wake).toBe("release");
  });

  it("locks settings while running and keeps them on reset", () => {
    const started = reduce(base(), { type: "toggle", now: 0 });
    expect(reduce(started.model, { type: "step", key: "work", dir: 1 }).model.cfg.work).toBe(20);
    expect(reduce(started.model, { type: "preset", id: "hiit" }).model.cfg.work).toBe(20);
    expect(reduce(started.model, { type: "sound", on: false }).model.sound).toBe(true);
    expect(reduce(started.model, { type: "beeps", value: 0 }).model.cfg.beeps).toBe(3);
    const reset = reduce(started.model, { type: "reset" });
    expect(reset.model.timer.status).toBe("idle");
    expect(reset.model.cfg).toEqual(DEFAULT_SETTINGS);
    expect(reset.effect.wake).toBe("release");
    const edited = reduce(reset.model, { type: "step", key: "work", dir: 1 });
    expect(edited.model.cfg.work).toBe(25);
    expect(edited.effect.persist).toBe(true);
    const preset = reduce(edited.model, { type: "preset", id: "beginner" });
    expect(preset.model.cfg.work).toBe(20);
    expect(preset.model.cfg.beeps).toBe(3);
  });

  it("offers reload only from setup", () => {
    const ready = reduce(base(), { type: "update-ready" });
    expect(reduce(ready.model, { type: "reload" }).effect.reload).toBe(true);
    const running = reduce(ready.model, { type: "toggle", now: 0 });
    expect(reduce(running.model, { type: "reload" }).effect.reload).toBe(false);
    expect(reduce(running.model, { type: "update-ready" }).model.updateReady).toBe(true);
  });

  it("does not acquire the wake lock when the toggle is off", () => {
    const quiet = createModel({ ...DEFAULT_PERSISTED, awake: false });
    expect(reduce(quiet, { type: "toggle", now: 0 }).effect.wake).toBe("keep");
  });
});
