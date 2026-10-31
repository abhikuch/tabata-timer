export function isIos(ua: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

export function shouldShowIosAudioHint(ios: boolean, soundOn: boolean, dismissed: boolean): boolean {
  return ios && soundOn && !dismissed;
}

export function shouldShowIosInstallHint(ios: boolean, standalone: boolean, dismissed: boolean): boolean {
  return ios && !standalone && !dismissed;
}

export function nextHoldWait(elapsedMs: number): number {
  if (elapsedMs < 400) return 400 - elapsedMs;
  if (elapsedMs >= 2000) return 20;
  return 100;
}

export interface KeyInput {
  key: string;
  repeat: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
}

export type Command = "toggle" | "next" | "prev" | "reset";

export function commandFromKey(event: KeyInput): Command | null {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return null;
  if (isTextField(event.target)) return null;
  if (event.key === " " || event.key === "Spacebar") return "toggle";
  if (event.key === "ArrowRight") return "next";
  if (event.key === "ArrowLeft") return "prev";
  if (event.key === "r" || event.key === "R") return "reset";
  return null;
}

function isTextField(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const node = target as { tagName?: string; isContentEditable?: boolean };
  const tag = node.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return node.isContentEditable === true;
}
