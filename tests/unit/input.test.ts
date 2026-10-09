import { describe, expect, it } from 'vitest';
import { DoubleTap, zoomSensitivity } from '../../src/input/input';

describe('double-press (Spring Jump)', () => {
  it('fires on a second press within the window, then starts over', () => {
    const d = new DoubleTap(300);
    expect(d.press(0)).toBe(false);
    expect(d.press(250)).toBe(true);
    // a third quick press is the first of a new pair
    expect(d.press(400)).toBe(false);
    expect(d.press(1000)).toBe(false);
    // too slow
    expect(d.press(1350)).toBe(false);
    expect(d.press(1500)).toBe(true);
    d.reset();
    expect(d.press(1600)).toBe(false);
  });
});

describe('scoped aim speed', () => {
  // how far the view moves on screen (pixels at the crosshair) for one unit of aim input
  const onScreen = (fov: number, base: number, h = 1000) => {
    const radPerUnit = 0.0022 * zoomSensitivity(fov, base);
    return (radPerUnit * (h / 2)) / Math.tan((fov * Math.PI) / 360);
  };

  it('is unchanged without zoom', () => {
    expect(zoomSensitivity(78, 78)).toBeCloseTo(1, 12);
  });

  it('moves the scoped view as far across the screen as the unscoped one, at every zoom', () => {
    for (const zoom of [1.8, 2, 2.5, 3, 8]) {
      expect(onScreen(78 / zoom, 78)).toBeCloseTo(onScreen(78, 78), 9);
      expect(onScreen(100 / zoom, 100)).toBeCloseTo(onScreen(100, 100), 9);
    }
  });

  it('is slower the further you zoom, and safe with odd values', () => {
    expect(zoomSensitivity(78 / 8, 78)).toBeLessThan(zoomSensitivity(78 / 3, 78));
    expect(zoomSensitivity(0, 78)).toBe(1);
    expect(zoomSensitivity(Number.NaN, 78)).toBe(1);
  });
});
