import { describe, expect, it } from 'vitest';
import { DynRes } from '../../src/render/dynres';

/** A 60 Hz screen: a frame shows on the first vsync after it's ready. */
const vsync60 = (cost: number) => Math.ceil(cost / (1 / 60) - 1e-9) * (1 / 60);

/** Run `seconds` of frames whose cost depends on the render scale; returns the scales seen at each change. */
function run(d: DynRes, seconds: number, cost: (scale: number, t: number) => number) {
  const changes: number[] = [];
  let t = 0;
  while (t < seconds) {
    const dt = vsync60(cost(d.scale, t));
    t += dt;
    if (d.frame(dt)) changes.push(d.scale);
  }
  return changes;
}

describe('dynamic resolution', () => {
  it('stays at full resolution while a 60 Hz screen keeps up', () => {
    const d = new DynRes(0.6);
    expect(run(d, 30, () => 0.012)).toEqual([]);
    expect(d.scale).toBe(1);
  });

  it('ignores a one-off hitch', () => {
    const d = new DynRes(0.6);
    run(d, 30, (_s, t) => (t > 10 && t < 10.4 ? 0.08 : 0.012));
    expect(d.scale).toBe(1);
  });

  it('lowers under a heavy pixel load, then comes all the way back on a 60 Hz screen when the load goes away', () => {
    const d = new DynRes(0.5);
    // cost grows with the pixel count (scale²): 30 ms at full resolution during a big fight
    run(d, 30, (s) => 0.008 + 0.022 * s * s);
    expect(d.scale).toBeLessThan(1);
    expect(d.scale).toBeGreaterThanOrEqual(0.5);
    // the fight is over: 10 ms at full resolution, capped to 16.7 ms by vsync
    run(d, 90, (s) => 0.006 + 0.004 * s * s);
    expect(d.scale).toBe(1);
  });

  it('does not blur a 30 fps power-saving cap it cannot fix', () => {
    const d = new DynRes(0.5);
    // one probe down (fewer pixels make no difference), then straight back up for good
    const first = run(d, 20, () => 1 / 30);
    expect(first.length).toBeLessThanOrEqual(7);
    expect(d.scale).toBe(1);
    expect(run(d, 60, () => 1 / 30)).toEqual([]);
  });

  it('does not see-saw forever on the edge', () => {
    const d = new DynRes(0.5);
    // full resolution is just too slow, one step down is just fast enough
    const changes = run(d, 180, (s) => 0.006 + 0.0148 * s * s);
    expect(changes.length).toBeLessThan(16);
    // and it ends up somewhere that keeps up
    expect(0.006 + 0.0148 * d.scale * d.scale).toBeLessThan(1 / 60);
  });

  it('starts over at full resolution with new graphics settings', () => {
    const d = new DynRes(0.5);
    run(d, 30, (s) => 0.008 + 0.022 * s * s);
    expect(d.scale).toBeLessThan(1);
    d.reset();
    expect(d.scale).toBe(1);
  });
});
