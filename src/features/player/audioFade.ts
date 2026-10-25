// One media element, with a temporary gain separate from the user's saved volume.
export class AudioFade {
  gain = 1;
  expectedVolume = 1;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #finish: ((completed: boolean) => void) | undefined;
  constructor(private audio: HTMLAudioElement, private volume: () => number, private unsupported: () => void) {}
  apply() {
    this.expectedVolume = this.volume() * this.gain;
    try { this.audio.volume = this.expectedVolume; } catch { this.expectedVolume = this.audio.volume; this.unsupported(); return false; }
    if (Math.abs(this.audio.volume - this.expectedVolume) > .01) {
      this.expectedVolume = this.audio.volume; this.unsupported(); return false;
    }
    return true;
  }
  cancel() {
    clearTimeout(this.#timer); this.#timer = undefined;
    const finish = this.#finish; this.#finish = undefined; finish?.(false);
  }
  reset() { this.cancel(); this.gain = 1; this.apply(); }
  ramp(target: number, durationMs: number) {
    this.cancel();
    const from = this.gain; const started = Date.now();
    return new Promise<boolean>((resolve) => {
      this.#finish = resolve;
      const tick = () => {
        const progress = durationMs > 0 ? Math.min(1, (Date.now() - started) / durationMs) : 1;
        this.gain = from + (target - from) * progress;
        if (!this.apply() || progress >= 1) { this.#timer = undefined; this.#finish = undefined; resolve(true); return; }
        this.#timer = setTimeout(tick, Math.min(16, Math.max(1, durationMs - (Date.now() - started))));
      };
      tick();
    });
  }
}
