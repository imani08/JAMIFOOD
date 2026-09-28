import { describe, expect, it } from 'vitest';
import { menuRemaining } from './menus';

describe('published menu inventory', () => {
  it('subtracts sold and reserved quantities from the configured amount', () => {
    expect(menuRemaining(20, 1, 0)).toBe(19);
    expect(menuRemaining(20, 1, 2)).toBe(17);
  });

  it('never exposes a negative remaining quantity when counters exceed the plan', () => {
    expect(menuRemaining(20, 1, 22)).toBe(0);
  });
});
