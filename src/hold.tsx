import type { JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { nextHoldWait } from "./platform";

export function useHoldRepeat(onStep: () => boolean, disabled = false): JSX.HTMLAttributes<HTMLButtonElement> {
  const skipClick = useRef(false);
  const timers = useRef<number[]>([]);
  const stepRef = useRef(onStep);
  stepRef.current = onStep;

  const clear = () => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  };

  useEffect(() => clear, []);

  const stop = () => {
    clear();
    window.setTimeout(() => {
      skipClick.current = false;
    }, 0);
  };

  return {
    onPointerDown(event) {
      if (disabled || event.button !== 0) return;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      skipClick.current = true;
      const started = Date.now();
      const fire = () => {
        if (!stepRef.current()) {
          clear();
          return;
        }
        const id = window.setTimeout(fire, nextHoldWait(Date.now() - started));
        timers.current.push(id);
      };
      fire();
    },
    onPointerUp: stop,
    onPointerCancel: stop,
    onLostPointerCapture: stop,
    onClick(event) {
      if (skipClick.current) {
        skipClick.current = false;
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
