import { describe, expect, it } from "vitest";
import { commandFromKey, isIos, nextHoldWait, shouldShowIosAudioHint, shouldShowIosInstallHint } from "./platform";

describe("platform and keys", () => {
  it("detects iPhone and iPad", () => {
    expect(isIos("Mozilla iPhone", "iPhone", 0)).toBe(true);
    expect(isIos("Mozilla", "MacIntel", 5)).toBe(true);
    expect(isIos("Mozilla", "MacIntel", 0)).toBe(false);
  });

  it("shows the one-time iOS hints only in the right state", () => {
    expect(shouldShowIosAudioHint(true, true, false)).toBe(true);
    expect(shouldShowIosAudioHint(true, false, false)).toBe(false);
    expect(shouldShowIosAudioHint(true, true, true)).toBe(false);
    expect(shouldShowIosInstallHint(true, false, false)).toBe(true);
    expect(shouldShowIosInstallHint(true, true, false)).toBe(false);
    expect(shouldShowIosInstallHint(false, false, false)).toBe(false);
  });

  it("maps the workout keys and ignores fields and shortcuts", () => {
    const plain = { repeat: false, metaKey: false, ctrlKey: false, altKey: false, target: null };
    expect(commandFromKey({ ...plain, key: " " })).toBe("toggle");
    expect(commandFromKey({ ...plain, key: "ArrowRight" })).toBe("next");
    expect(commandFromKey({ ...plain, key: "ArrowLeft" })).toBe("prev");
    expect(commandFromKey({ ...plain, key: "r" })).toBe("reset");
    expect(commandFromKey({ ...plain, key: "r", metaKey: true })).toBeNull();
    expect(commandFromKey({ ...plain, key: " ", repeat: true })).toBeNull();
    expect(commandFromKey({ ...plain, key: " ", target: { tagName: "INPUT" } as unknown as EventTarget })).toBeNull();
    expect(commandFromKey({ ...plain, key: " ", target: { tagName: "BUTTON" } as unknown as EventTarget })).toBe("toggle");
  });

  it("repeats a hold slowly, then five times faster after 2s", () => {
    expect(nextHoldWait(0)).toBe(400);
    expect(nextHoldWait(400)).toBe(100);
    expect(nextHoldWait(1900)).toBe(100);
    expect(nextHoldWait(2000)).toBe(20);
    const times = [0];
    let elapsed = 0;
    while (elapsed < 2200) {
      elapsed += nextHoldWait(elapsed);
      if (elapsed <= 2200) times.push(elapsed);
    }
    expect(times.filter((time) => time <= 2000)).toHaveLength(18);
    expect(times).toContain(2020);
    expect(times).toContain(2040);
  });
});
