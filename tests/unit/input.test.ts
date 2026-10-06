import { describe, expect, it } from 'vitest';
import { DoubleTap } from '../../src/input/input';

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
