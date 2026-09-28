import { describe, expect, it } from 'vitest';
import { ORDER_TRANSITIONS } from './index';

describe('transitions de commande', () => {
  it('autorise le flux direct vers retrait', () => {
    expect(ORDER_TRANSITIONS.CONFIRMED).toContain('READY');
    expect(ORDER_TRANSITIONS.READY).toContain('SERVED');
  });
  it('interdit de servir deux fois', () => {
    expect(ORDER_TRANSITIONS.SERVED).toEqual([]);
  });
});
