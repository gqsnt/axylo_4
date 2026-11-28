import type { FrameRun } from "./controller-types";
import type { FrameState } from "./frame-state";

type Advance<T> = (target: T, phase: keyof FrameRun) => boolean | void;

function readout<T>(target: T, advance: Advance<T>, single?: FrameState): void {
  if (!single?.compact || single.needMeasure) {
    if (advance(target, "phase3LayoutCheck")) {
      advance(target, "phase3StripMount");
      try {
        advance(target, "phase3StripRead");
      } finally {
        advance(target, "phase3StripRemove");
      }
    }
    advance(target, "phase3ReadoutDecide");
    advance(target, "phase4StripWrite");
    advance(target, "phase4StripMeasure");
  }
  advance(target, "phase4Init");
}

/** Phase 1 may be batched with theme preparation. The remaining DOM reads and writes use this order. */
export function finishPhases<T>(target: T, advance: Advance<T>, single?: FrameState): void {
  advance(target, "phase2");
  // Measure first so the theme sees up-to-date style. Only a probe which moved the figure needs another read.
  advance(target, "phase3Measure");
  advance(target, "phase3Theme");
  advance(target, "phase3Probe");
  advance(target, "phase3Measure");
  readout(target, advance, single);
  for (let pass = 0; pass < 4 && advance(target, "phase4PassWrite"); pass++) {
    if (advance(target, "phase4PassMeasure")) readout(target, advance, single);
  }
  advance(target, "phase5");
  advance(target, "after");
}

export function advanceOne(run: FrameRun, phase: keyof FrameRun): boolean | void {
  return run[phase]();
}

/** The pooled state and a single-use batch handle share the guards at each DOM barrier. */
export abstract class FrameSteps implements FrameRun {
  protected abstract get state(): FrameState | null;
  phase1(): void {
    const f = this.state;
    if (f) f.driver!.frameStep(f, "phase1");
  }
  phase2(): void {
    const f = this.state;
    if (f) f.driver!.frameStep(f, "phase2");
  }
  phase3Theme(): void {
    const f = this.state;
    if (f && f.preparedTheme !== null) f.driver!.frameStep(f, "phase3Theme");
  }
  phase3Measure(): void {
    const f = this.state;
    if (f && f.needMeasure) f.driver!.frameStep(f, "phase3Measure");
  }
  phase3Probe(): void {
    const f = this.state;
    if (f && f.needsThemeProbe) f.driver!.frameStep(f, "phase3Probe");
  }
  phase3LayoutCheck(): boolean {
    const f = this.state;
    return !!f && (!f.compact || f.needMeasure) && f.driver!.frameStep(f, "phase3LayoutCheck");
  }
  phase3StripMount(): void {
    const f = this.state;
    if (f && f.needsStripProbe) f.driver!.frameStep(f, "phase3StripMount");
  }
  phase3StripRead(): void {
    const f = this.state;
    if (f && f.needsStripProbe) f.driver!.frameStep(f, "phase3StripRead");
  }
  phase3ReadoutDecide(): void {
    const f = this.state;
    if (f && f.withoutLayout) f.driver!.frameStep(f, "phase3ReadoutDecide");
  }
  phase4StripWrite(): void {
    const f = this.state;
    if (f && f.stripAction) f.driver!.frameStep(f, "phase4StripWrite");
  }
  phase4StripMeasure(): void {
    const f = this.state;
    if (f && f.stripAction) f.driver!.frameStep(f, "phase4StripMeasure");
  }
  phase4Init(): void {
    const f = this.state;
    if (f && f.readoutPending) f.driver!.frameStep(f, "phase4Init");
  }
  phase4PassWrite(): boolean {
    const f = this.state;
    return !!f && !f.layoutDone && f.driver!.frameStep(f, "phase4PassWrite");
  }
  phase4PassMeasure(): boolean {
    const f = this.state;
    return !!f && !!f.passAction && f.driver!.frameStep(f, "phase4PassMeasure");
  }
  phase3StripRemove(): void {
    const f = this.state;
    if (f) f.driver!.removeStripProbe(f);
  }
  phase5(): void {
    const f = this.state;
    if (f) f.driver!.frameStep(f, "phase5");
  }
  abstract after(): void;
}

export class FrameHandle extends FrameSteps {
  #frame: FrameState | null;
  constructor(frame: FrameState) {
    super();
    this.#frame = frame;
  }
  protected get state() {
    return this.#frame;
  }
  after(): void {
    const f = this.#frame;
    this.#frame = null;
    if (f) f.after();
  }
}
