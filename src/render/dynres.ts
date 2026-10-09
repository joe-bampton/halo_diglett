/**
 * Dynamic resolution: lowers the render scale while frames are being missed and raises it again once there is
 * headroom.
 *
 * - Judged per window of frames by the *median* frame time, so one hitch (a GC pause, a shader compile) doesn't count.
 * - The target is 60 fps. Vsync caps the frame rate, so "fast enough" means at (or near) 60 fps, never "faster than
 *   60": a 60 Hz screen always reports ~16.7 ms frames, and the scale must still be able to come back up.
 * - Stepping down is a probe. With vsync a frame that takes 25 ms and one that takes 30 ms both show as 33 ms, so one
 *   step may not show any gain: keep stepping until frames get faster (it was the pixels) or the floor is reached
 *   without any gain (a 30 fps power-saving cap or a busy CPU — then the steps are undone and that frame time is left
 *   alone).
 * - A step up that has to be undone soon after makes the next attempt wait twice as long (no endless see-saw); once a
 *   step up sticks, things changed and it's back to quick steps.
 */
export class DynRes {
  /** current multiplier on the render resolution (lo..hi) */
  scale: number;
  private times: number[] = [];
  private warm = 0;
  private good = 0;
  private need = 2;
  private sinceUp = Infinity;
  /** stepping down from this scale, where frames took this long: has it helped yet? */
  private probe: { from: number; median: number } | null = null;
  /** a frame time that lowering the resolution couldn't fix (don't chase it again unless things get worse); 0 = none */
  private floor = 0;

  constructor(
    readonly lo: number,
    readonly hi = 1,
    private readonly step = 0.1,
    private readonly window = 90,
    private readonly target = 1 / 60,
  ) {
    this.scale = hi;
    this.pause();
  }

  /** Measure afresh after a pause (start of a match, back from a hidden tab). */
  pause(warmSec = 1.5) {
    this.times = [];
    this.warm = warmSec;
    this.good = 0;
    this.probe = null;
  }

  /** New graphics settings: back to full resolution, and forget what was learned about this device. */
  reset() {
    this.scale = this.hi;
    this.floor = 0;
    this.need = 2;
    this.sinceUp = Infinity;
    this.pause();
  }

  /** Feed the real time since the previous frame (seconds). Returns true when `scale` changed. */
  frame(dt: number): boolean {
    if (!(dt > 0) || dt > 0.5) return false; // a stall or a hidden tab says nothing about rendering cost
    if (this.warm > 0) {
      this.warm -= dt;
      return false;
    }
    this.times.push(dt);
    // probes and the first window after a step up are short: until they're settled the screen is blurrier (or
    // choppier) than it needs to be
    const quick = !!this.probe || this.sinceUp === 0;
    if (this.times.length < (quick ? Math.min(30, this.window) : this.window)) return false;
    const sorted = this.times.sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1]!;
    this.times = [];
    this.sinceUp++;
    if (this.sinceUp === 3) this.need = 2; // that step up stuck
    const slow = median > this.target * 1.25 && median > this.floor * 1.12;
    const p = this.probe;
    if (p) {
      if (!slow || median <= p.median * 0.92) this.probe = null; // fewer pixels helped (or it's fast enough now)
      else if (this.scale <= this.lo + 1e-6) {
        // all the way down and no faster: it isn't the pixels
        this.probe = null;
        this.floor = p.median;
        return this.set(p.from);
      } else return this.set(Math.max(this.lo, this.scale - this.step));
    }
    if (slow && this.scale > this.lo + 1e-6) {
      // that step up didn't hold: wait twice as long before the next one
      if (this.sinceUp <= 2) this.need = Math.min(32, this.need * 2);
      this.sinceUp = Infinity;
      this.good = 0;
      this.probe = { from: this.scale, median };
      return this.set(Math.max(this.lo, this.scale - this.step));
    }
    if (median <= this.target * 1.08 && this.scale < this.hi - 1e-6) {
      if (++this.good >= this.need) {
        this.good = 0;
        this.sinceUp = 0;
        return this.set(Math.min(this.hi, this.scale + this.step));
      }
    } else this.good = 0;
    return false;
  }

  private set(scale: number): boolean {
    // the resize itself costs a frame or two: let it settle before measuring again
    this.warm = 0.3;
    this.times = [];
    const changed = Math.abs(scale - this.scale) > 1e-6;
    this.scale = scale;
    return changed;
  }
}
