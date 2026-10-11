/**
 * Måler bildefrekvens fra tidsstemplene i tegnesløyfa (fungerer både på
 * laptop og i VR, der XR-økta styrer frekvensen).
 */
export class FpsMeter {
  fps = 0;
  /** Laveste sekund-snitt de siste 5 sekundene. */
  minFps = 0;
  /** Lengste enkeltramme (ms) siste sekund. */
  worstFrameMs = 0;
  /** Tapte rammer siste sekund (mellomrom > 1,5 × vanlig rammetid). */
  dropped = 0;
  private droppedNow = 0;
  private period = 0;
  private frames = 0;
  private windowStart = -1;
  private lastTime = -1;
  private worst = 0;
  private readonly history: number[] = [];
  private readonly listeners = new Set<() => void>();

  tick(now: number): void {
    if (this.windowStart < 0) {
      this.windowStart = now;
      this.lastTime = now;
      return;
    }
    this.frames++;
    const gap = now - this.lastTime;
    this.worst = Math.max(this.worst, gap);
    if (this.period > 0 && gap > this.period * 1.5) this.droppedNow++;
    this.lastTime = now;
    const elapsed = now - this.windowStart;
    if (elapsed >= 1000) {
      this.fps = (this.frames * 1000) / elapsed;
      this.history.push(this.fps);
      if (this.history.length > 5) this.history.shift();
      this.minFps = Math.min(...this.history);
      this.worstFrameMs = this.worst;
      this.period = elapsed / Math.max(1, this.frames);
      this.dropped = this.droppedNow;
      this.droppedNow = 0;
      this.frames = 0;
      this.worst = 0;
      this.windowStart = now;
      for (const l of this.listeners) l();
    }
  }

  /** Nullstill (f.eks. når VR starter, så målingen ikke blandes). */
  reset(): void {
    this.windowStart = -1;
    this.history.length = 0;
    this.frames = 0;
    this.worst = 0;
    this.period = 0;
    this.dropped = 0;
    this.droppedNow = 0;
  }

  label(): string {
    return `${Math.round(this.fps)} fps · min ${Math.round(this.minFps)} · ${this.worstFrameMs.toFixed(1)} ms · ${this.dropped} tapt`;
  }

  onUpdate(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
