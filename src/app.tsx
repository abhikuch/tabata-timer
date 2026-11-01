import { useEffect, useRef, useState } from "preact/hooks";
import type { AudioSink } from "./audio";
import { createAudio } from "./audio";
import { ringGeometry, selectView, wakeDescription } from "./display";
import { liveRemainingMs } from "./engine";
import { useHoldRepeat } from "./hold";
import { reduce, toPersisted, type Model } from "./model";
import { createModel } from "./model";
import { commandFromKey, isIos, shouldShowIosAudioHint, shouldShowIosInstallHint } from "./platform";
import { reloadApp } from "./register";
import { loadHints, loadPersisted, saveHints, savePersisted, type HintFlags } from "./storage";
import type { Beeps, Cue, FieldKey } from "./types";
import { createWake, readWakeApi, type WakeApi } from "./wake";

export interface PlatformInfo {
  ios: boolean;
  standalone: boolean;
  wakeLock: boolean;
}

interface BeforeInstall {
  prompt: () => Promise<void>;
  preventDefault: () => void;
}

interface AppProps {
  audio?: AudioSink;
  platform?: PlatformInfo;
  wakeApi?: WakeApi | null;
  animate?: boolean;
  storage?: Storage;
}

function browserPlatform(): PlatformInfo {
  const nav = navigator as Navigator & { standalone?: boolean };
  const standalone = window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
  return {
    ios: isIos(navigator.userAgent || "", navigator.platform || "", navigator.maxTouchPoints || 0),
    standalone,
    wakeLock: "wakeLock" in navigator,
  };
}

function memoryStore(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear() { data.clear(); },
    getItem(key: string) { return data.has(key) ? data.get(key)! : null; },
    key(index: number) { return [...data.keys()][index] ?? null; },
    removeItem(key: string) { data.delete(key); },
    setItem(key: string, value: string) { data.set(key, value); },
  };
}

function safeStorage(): Storage {
  try {
    const probe = window.localStorage;
    probe.getItem("tabata.v1");
    return probe;
  } catch {
    return memoryStore();
  }
}

export function App({ audio, platform, wakeApi, animate = true, storage }: AppProps = {}) {
  const store = storage ?? safeStorage();
  const info = platform ?? browserPlatform();
  const [model, setModel] = useState<Model>(() => createModel(loadPersisted(store)));
  const [hints, setHints] = useState<HintFlags>(() => loadHints(store));
  const [install, setInstall] = useState<BeforeInstall | null>(null);
  const modelRef = useRef(model);
  const audioRef = useRef<AudioSink>(audio ?? createAudio());
  const wakeRef = useRef(createWake(wakeApi === undefined ? readWakeApi() : wakeApi));
  const ringRef = useRef<SVGCircleElement>(null);
  modelRef.current = model;

  const paint = (current: Model, now = Date.now()) => {
    const el = ringRef.current;
    const timer = current.timer;
    const interval = timer.plan[timer.index];
    if (!el || !interval || timer.status !== "running") return;
    const geo = ringGeometry(Math.max(0, liveRemainingMs(timer, now)), interval.durationMs);
    el.setAttribute("stroke-dasharray", geo.circumference.toFixed(3));
    el.setAttribute("stroke-dashoffset", geo.offset.toFixed(3));
  };

  const apply = (result: ReturnType<typeof reduce>) => {
    modelRef.current = result.model;
    setModel(result.model);
    const flags = { sound: result.model.sound, vibe: result.model.vibe };
    for (const cue of result.effect.cues) audioRef.current.play(cue, flags);
    if (result.effect.wake === "acquire") void wakeRef.current.acquire();
    else if (result.effect.wake === "release") wakeRef.current.release();
    if (result.effect.persist) savePersisted(store, toPersisted(result.model));
    if (result.effect.reload) reloadApp();
    audioRef.current.syncPlayback?.(result.model.timer.status);
    paint(result.model);
  };

  const act = (action: Parameters<typeof reduce>[1]) => apply(reduce(modelRef.current, action));

  useEffect(() => {
    if (model.timer.status !== "running") return;
    const frame = () => {
      const now = Date.now();
      const result = reduce(modelRef.current, { type: "tick", now });
      if (result.model !== modelRef.current || result.effect.cues.length) apply(result);
      else paint(modelRef.current, now);
    };
    const id = window.setInterval(frame, 100);
    let raf = 0;
    const loop = () => {
      frame();
      raf = window.requestAnimationFrame(loop);
    };
    if (animate) raf = window.requestAnimationFrame(loop);
    const arm = () => {
      const current = modelRef.current;
      audioRef.current.armBackground?.(current.timer, Date.now(), { sound: current.sound, vibe: current.vibe });
    };
    const onShow = () => {
      if (document.visibilityState === "hidden") {
        arm();
        return;
      }
      const heard = audioRef.current.disarmBackground?.() ?? false;
      const result = reduce(modelRef.current, { type: "foreground", now: Date.now() });
      apply(heard ? { ...result, effect: { ...result.effect, cues: [] } } : result);
    };
    document.addEventListener("visibilitychange", onShow);
    window.addEventListener("pagehide", arm);
    window.addEventListener("pageshow", onShow);
    return () => {
      window.clearInterval(id);
      if (raf) window.cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onShow);
      window.removeEventListener("pagehide", arm);
      window.removeEventListener("pageshow", onShow);
    };
  }, [model.timer.status, animate]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const command = commandFromKey(event);
      if (!command) return;
      event.preventDefault();
      const now = Date.now();
      if (command === "toggle") act({ type: "toggle", now });
      else if (command === "next") act({ type: "next", now });
      else if (command === "prev") act({ type: "prev", now });
      else act({ type: "reset" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstall(event as unknown as BeforeInstall);
    };
    const onUpdate = () => act({ type: "update-ready" });
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("tabata:update", onUpdate);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("tabata:update", onUpdate);
    };
  }, []);

  const view = selectView(model.cfg, model.timer, Date.now(), model.updateReady);
  const showAudioHint = shouldShowIosAudioHint(info.ios, model.sound, hints.dismissedAudio);
  const showInstallHint = shouldShowIosInstallHint(info.ios, info.standalone, hints.dismissedInstall);

  const dismiss = (patch: Partial<HintFlags>) => {
    const next = { ...hints, ...patch };
    setHints(next);
    saveHints(store, next);
  };

  const bump = (key: FieldKey, dir: -1 | 1) => {
    const current = modelRef.current;
    const result = reduce(current, { type: "step", key, dir });
    if (result.model === current) return false;
    apply(result);
    return true;
  };

  const toggleMain = () => {
    audioRef.current.unlock();
    act({ type: "toggle", now: Date.now() });
  };

  return (
    <div class="app">
      <header class="header">
        <div>
          <div class="kicker">Interval timer</div>
          <h1>Tabata</h1>
          <div class="sub">{view.headerSub}</div>
        </div>
        {view.paused ? <span class="tag">Paused</span> : null}
      </header>
      {view.showUpdate ? <button type="button" class="update" onClick={() => act({ type: "reload" })}>Update available · Reload</button> : null}
      {model.timer.status === "done" ? (
        <Done view={view} onEdit={() => act({ type: "reset" })} onAgain={toggleMain} />
      ) : model.timer.status === "idle" ? (
        <Setup
          view={view}
          beeps={model.cfg.beeps}
          sound={model.sound}
          vibe={model.vibe}
          awake={model.awake}
          wakeText={wakeDescription(info.wakeLock)}
          showAudioHint={showAudioHint}
          showInstallHint={showInstallHint}
          showInstall={install != null}
          onPreset={(id) => act({ type: "preset", id })}
          onBump={bump}
          onSound={(on) => { audioRef.current.unlock(); act({ type: "sound", on }); }}
          onVibe={(on) => act({ type: "vibe", on })}
          onAwake={(on) => act({ type: "awake", on })}
          onBeeps={(value) => act({ type: "beeps", value })}
          onDismissAudio={() => dismiss({ dismissedAudio: true })}
          onDismissInstall={() => dismiss({ dismissedInstall: true })}
          onInstall={() => { void install?.prompt(); setInstall(null); }}
          onStart={toggleMain}
        />
      ) : (
        <Run view={view} ringRef={ringRef} onToggle={toggleMain} onReset={() => act({ type: "reset" })} onPrev={() => act({ type: "prev", now: Date.now() })} onNext={() => act({ type: "next", now: Date.now() })} />
      )}
    </div>
  );
}

function Setup(props: {
  view: ReturnType<typeof selectView>;
  beeps: Beeps;
  sound: boolean;
  vibe: boolean;
  awake: boolean;
  wakeText: string;
  showAudioHint: boolean;
  showInstallHint: boolean;
  showInstall: boolean;
  onPreset: (id: "tabata" | "beginner" | "hiit" | "endurance") => void;
  onBump: (key: FieldKey, dir: -1 | 1) => boolean;
  onSound: (on: boolean) => void;
  onVibe: (on: boolean) => void;
  onAwake: (on: boolean) => void;
  onBeeps: (value: Beeps) => void;
  onDismissAudio: () => void;
  onDismissInstall: () => void;
  onInstall: () => void;
  onStart: () => void;
}) {
  const { view } = props;
  return (
    <div class="stage">
      <div class="scroll">
        <div>
          <div class="kicker">Presets</div>
          <div class="chips" role="group" aria-label="Presets">
            {view.presets.map((preset) => (
              <button key={preset.id} type="button" class="chip" aria-pressed={preset.selected} onClick={() => props.onPreset(preset.id)}>{preset.label}</button>
            ))}
            {props.showInstall ? <button type="button" class="chip" onClick={props.onInstall}>Install app</button> : null}
          </div>
        </div>
        <section class="card" aria-label="Intervals">
          {view.fields.map((field) => (
            <Stepper key={field.key} field={field} onBump={props.onBump} />
          ))}
        </section>
        <section class="card alerts" aria-label="Sound and alerts">
          <Switch label="Sound" description="Louder beeps, including if you leave this screen" checked={props.sound} onChange={props.onSound} />
          {props.showAudioHint ? <p class="hint">On iPhone, the silent switch mutes these beeps. Flip it so the ringer is on. <button type="button" onClick={props.onDismissAudio}>Dismiss</button></p> : null}
          <Switch label="Vibration" description="Buzz on Android when the phase changes" checked={props.vibe} onChange={props.onVibe} />
          <Switch label="Keep screen awake" description={props.wakeText} checked={props.awake} onChange={props.onAwake} />
          <div class="seg-wrap">
            <div class="kicker">Count-in beeps</div>
            <div class="seg" role="radiogroup" aria-label="Count-in beeps">
              {([[0, "Off"], [3, "3 s"], [5, "5 s"]] as const).map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={props.beeps === value} onClick={() => props.onBeeps(value)}>{label}</button>
              ))}
            </div>
          </div>
        </section>
        {props.showInstallHint ? <p class="hint">Share → Add to Home Screen <button type="button" onClick={props.onDismissInstall}>Dismiss</button></p> : null}
        <p class="note">Settings are saved on this device. Works offline once installed.</p>
      </div>
      <div class="bar">
        <div>
          <div class="kicker">Total</div>
          <div class="total">{view.totalText}</div>
        </div>
        <button type="button" class="btn primary" onClick={props.onStart}>Start workout</button>
      </div>
    </div>
  );
}

function Stepper({ field, onBump }: { field: ReturnType<typeof selectView>["fields"][number]; onBump: (key: FieldKey, dir: -1 | 1) => boolean }) {
  const dec = useHoldRepeat(() => onBump(field.key, -1), field.atMin);
  const inc = useHoldRepeat(() => onBump(field.key, 1), field.atMax);
  return (
    <div class="row">
      <span class="tile" aria-hidden="true" style={{ color: field.tint }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d={field.icon} /></svg>
      </span>
      <div class="row-copy">
        <strong>{field.label}</strong>
        <span>{field.hint}</span>
      </div>
      <button type="button" class="step" aria-label={field.decLabel} disabled={field.atMin} {...dec}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12h14" /></svg>
      </button>
      <span class="value">{field.value}</span>
      <button type="button" class="step" aria-label={field.incLabel} disabled={field.atMax} {...inc}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12h14M12 5v14" /></svg>
      </button>
    </div>
  );
}

function Switch(props: { label: string; description: string; checked: boolean; onChange: (on: boolean) => void }) {
  const id = props.label.replace(/\s+/g, "-").toLowerCase();
  return (
    <button type="button" class="toggle" role="switch" aria-checked={props.checked} aria-labelledby={`${id}-label`} aria-describedby={`${id}-desc`} onClick={() => props.onChange(!props.checked)}>
      <span class="toggle-text">
        <strong id={`${id}-label`}>{props.label}</strong>
        <span id={`${id}-desc`}>{props.description}</span>
      </span>
      <span class={props.checked ? "switch on" : "switch"} aria-hidden="true"><i /></span>
    </button>
  );
}

function Run(props: {
  view: ReturnType<typeof selectView>;
  ringRef: { current: SVGCircleElement | null };
  onToggle: () => void;
  onReset: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { view } = props;
  return (
    <div class="stage">
      <div class="run">
        <div class="phase" aria-live="polite">
          <h2 style={{ color: view.phaseColor }}>{view.phaseLabel}</h2>
          <p>{view.phaseHint}{view.paused ? ". Paused." : ""}</p>
        </div>
        <div class="ring-wrap">
          <svg aria-hidden="true" viewBox="0 0 280 280">
            <circle cx="140" cy="140" r="128" fill="none" stroke="var(--surface-sunken)" stroke-width="14" />
            <circle ref={props.ringRef} class="ring-progress" cx="140" cy="140" r="128" fill="none" stroke={view.phaseColor} stroke-width="14" stroke-linecap="butt" stroke-dasharray={view.ringC} stroke-dashoffset={view.ringOffset} />
          </svg>
          <div class="readout">
            <span class="clock" role="timer" aria-label="Time left in this interval">{view.timerText}</span>
            <small>{view.segOfText}</small>
          </div>
          <button type="button" class="ring-hit" aria-label={view.paused ? "Resume workout" : "Pause workout"} onClick={props.onToggle} />
        </div>
        <div class="timeline">
          <div class="barline" aria-hidden="true" style={{ gap: `${view.timelineGap}px` }}>
            {view.timeline.map((seg, index) => (
              <div key={index} style={{ flex: `${seg.grow} 1 0px`, minWidth: "1px", background: seg.color, opacity: seg.opacity }} />
            ))}
          </div>
          <div class="meta"><span>{view.intervalText}</span><span>{view.pctText}</span></div>
        </div>
        <div class="stats">
          <div class="stat"><span class="kicker">Elapsed</span><b>{view.elapsedText}</b></div>
          <div class="stat"><span class="kicker">Left</span><b>{view.remainingText}</b></div>
          <div class="stat"><span class="kicker">Up next</span><b class="up" style={{ color: view.nextColor }}>{view.nextText}</b></div>
        </div>
      </div>
      <div class="bar">
        <button type="button" class="iconbtn" aria-label="Reset workout" onClick={props.onReset}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" /></svg>
        </button>
        <button type="button" class="iconbtn" aria-label="Previous interval" onClick={props.onPrev}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5 9 12l10 7V5zM5 5v14" /></svg>
        </button>
        <button type="button" class="btn primary" onClick={props.onToggle}>{view.mainLabel}</button>
        <button type="button" class="iconbtn" aria-label="Next interval" onClick={props.onNext}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l10 7-10 7V5zM19 5v14" /></svg>
        </button>
      </div>
    </div>
  );
}

function Done(props: { view: ReturnType<typeof selectView>; onEdit: () => void; onAgain: () => void }) {
  return (
    <div class="stage">
      <div class="done">
        <div class="check" aria-hidden="true">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 9.5 17 19 7.5" /></svg>
        </div>
        <div aria-live="polite">
          <h2>Workout complete</h2>
          <p class="pull">{props.view.doneText}</p>
        </div>
        <div class="stats">
          <div class="stat"><span class="kicker">Total</span><b>{props.view.totalText}</b></div>
          <div class="stat"><span class="kicker">Work</span><b>{props.view.workText}</b></div>
          <div class="stat"><span class="kicker">Rounds</span><b>{props.view.worksCount}</b></div>
        </div>
      </div>
      <div class="bar end">
        <button type="button" class="btn secondary" onClick={props.onEdit}>Edit settings</button>
        <button type="button" class="btn primary" onClick={props.onAgain}>Start again</button>
      </div>
    </div>
  );
}

export type { Cue };
