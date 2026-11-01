import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { HOLD_ARM_MS, nextHoldWait } from "./platform";

export function useHoldRepeat(onStep: () => boolean, disabled = false): JSX.HTMLAttributes<HTMLButtonElement> {
  const skipClick = useRef(false);
  const timers = useRef<number[]>([]);
  const mode = useRef<"idle" | "down" | "holding">("idle");
  const stepRef = useRef(onStep);
  stepRef.current = onStep;

  const clear = () => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  };

  useEffect(() => clear, []);

  const finishPress = (commitTap: boolean) => {
    const pressed = mode.current;
    clear();
    mode.current = "idle";
    skipClick.current = true;
    window.setTimeout(() => {
      skipClick.current = false;
    }, 700);
    if (commitTap && pressed === "down") stepRef.current();
  };

  return {
    onPointerDown(event) {
      if (disabled || event.button !== 0 || mode.current !== "idle") return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      mode.current = "down";
      const started = Date.now();
      const pulse = () => {
        if (mode.current !== "holding") return;
        if (!stepRef.current()) {
          clear();
          mode.current = "idle";
          return;
        }
        const id = window.setTimeout(pulse, nextHoldWait(Date.now() - started));
        timers.current.push(id);
      };
      const arm = window.setTimeout(() => {
        mode.current = "holding";
        pulse();
      }, HOLD_ARM_MS);
      timers.current.push(arm);
    },
    onPointerUp() {
      finishPress(true);
    },
    onPointerCancel() {
      finishPress(false);
    },
    onClick(event) {
      if (skipClick.current) {
        event.preventDefault();
        return;
      }
      if (!disabled) stepRef.current();
    },
    onContextMenu(event) {
      event.preventDefault();
    },
  };
}
