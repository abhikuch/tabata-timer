/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app";
import type { AudioSink } from "./audio";
import type { Cue } from "./types";
import * as register from "./register";

const platform = { ios: false, standalone: false, wakeLock: false };

function sink() {
  const cues: Cue[] = [];
  const audio: AudioSink = {
    unlock: vi.fn(),
    play(cue) { cues.push(cue); },
  };
  return { audio, cues };
}

describe("app", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the default 4:00 Tabata and starts on the button", () => {
    const { audio, cues } = sink();
    render(<App audio={audio} platform={platform} animate={false} />);
    expect(screen.getByText("4:00")).toBeTruthy();
    expect(screen.getByText("4:00 total · 16 intervals")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tabata" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Start workout" }));
    expect(audio.unlock).toHaveBeenCalled();
    expect(screen.getByRole("timer").textContent).toBe("10");
    expect(screen.getByRole("heading", { name: "Get ready" })).toBeTruthy();
    expect(cues).toEqual([{ kind: "phase", phase: "prepare" }]);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByRole("heading", { name: "Work" })).toBeTruthy();
    expect(screen.getByRole("timer").textContent).toBe("20");
    expect(cues.map((cue) => cue.kind === "countIn" ? cue.second : cue.kind === "phase" ? cue.phase : cue.kind)).toEqual([
      "prepare", 3, 2, 1, "work",
    ]);
  });

  it("pauses without losing time, then resets", () => {
    const { audio } = sink();
    render(<App audio={audio} platform={platform} animate={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Start workout" }));
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByRole("timer").textContent).toBe("7");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByRole("timer").textContent).toBe("7");
    expect(screen.getByText("Paused")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("timer").textContent).toBe("6");
    fireEvent.click(screen.getByRole("button", { name: "Reset workout" }));
    expect(screen.getByRole("button", { name: "Start workout" })).toBeTruthy();
    expect(screen.getByText("4:00 total · 16 intervals")).toBeTruthy();
  });

  it("skips with the buttons and the keyboard without a double start", () => {
    const { audio, cues } = sink();
    render(<App audio={audio} platform={platform} animate={false} />);
    const start = screen.getByRole("button", { name: "Start workout" });
    start.focus();
    const event = new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    act(() => { start.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(cues).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Next interval" }));
    expect(screen.getByRole("heading", { name: "Work" })).toBeTruthy();
    expect(screen.getByRole("timer").textContent).toBe("20");
    fireEvent.click(screen.getByRole("button", { name: "Previous interval" }));
    expect(screen.getByRole("heading", { name: "Get ready" })).toBeTruthy();
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true, cancelable: true })); });
    expect(screen.getByRole("button", { name: "Start workout" })).toBeTruthy();
  });

  it("jumps to the right interval when the page returns", () => {
    const { audio } = sink();
    render(<App audio={audio} platform={platform} animate={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Start workout" }));
    act(() => {
      vi.setSystemTime(new Date(1_045_000));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.getByRole("heading", { name: "Work" })).toBeTruthy();
    expect(screen.getAllByText("Round 2 of 8").length).toBeGreaterThan(0);
    expect(screen.getByRole("timer").textContent).toBe("15");
  });

  it("finishes a short workout", () => {
    const { audio, cues } = sink();
    render(<App audio={audio} platform={platform} animate={false} />);
    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    clickTimes("Decrease Get ready", 2);
    clickTimes("Decrease Rest", 2);
    clickTimes("Decrease Rounds", 7);
    clickTimes("Decrease Work", 3);
    expect(document.querySelector(".total")?.textContent).toBe("0:05");
    fireEvent.click(screen.getByRole("button", { name: "Start workout" }));
    cues.length = 0;
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByRole("heading", { name: "Workout complete" })).toBeTruthy();
    expect(cues).toEqual([{ kind: "complete" }]);
    expect(screen.getByRole("button", { name: "Edit settings" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start again" }));
    expect(screen.getByRole("heading", { name: "Work" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset workout" }));
    expect(screen.getByRole("button", { name: "Start workout" })).toBeTruthy();
  });

  it("saves settings and ignores corrupt storage", () => {
    const { audio } = sink();
    const first = render(<App audio={audio} platform={platform} animate={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Decrease Get ready" }));
    expect(screen.getByText("0:05")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tabata" }).getAttribute("aria-pressed")).toBe("false");
    first.unmount();
    render(<App audio={audio} platform={platform} animate={false} />);
    expect(screen.getByText("0:05")).toBeTruthy();
    cleanup();
    localStorage.setItem("tabata.v1", "{");
    render(<App audio={audio} platform={platform} animate={false} />);
    expect(screen.getByText("4:00 total · 16 intervals")).toBeTruthy();
  });

  it("shows install, update, and the unsupported wake note", () => {
    const { audio } = sink();
    const reload = vi.spyOn(register, "reloadApp").mockImplementation(() => undefined);
    render(<App audio={audio} platform={{ ios: true, standalone: false, wakeLock: false }} animate={false} />);
    expect(screen.getByText(/Not supported on this browser/)).toBeTruthy();
    expect(screen.getByText(/Add to Home Screen/)).toBeTruthy();
    expect(screen.getByText(/silent switch/)).toBeTruthy();
    const prompt = vi.fn();
    act(() => {
      window.dispatchEvent(Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Install app" }));
    expect(prompt).toHaveBeenCalled();
    act(() => { window.dispatchEvent(new Event("tabata:update")); });
    fireEvent.click(screen.getByRole("button", { name: "Update available · Reload" }));
    expect(reload).toHaveBeenCalled();
    reload.mockRestore();
  });
});

function clickTimes(name: string, times: number) {
  for (let i = 0; i < times; i += 1) fireEvent.click(screen.getByRole("button", { name }));
}
