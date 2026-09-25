import { describe, expect, it } from 'vitest';
import { endDate, localDate, rightDates } from './business';
describe('calendrier Kinshasa', () => {
  it('termine à D+29 y compris sur une année bissextile', () => {
    expect(endDate('2024-02-01')).toBe('2024-03-01');
    expect(endDate('2026-12-15')).toBe('2027-01-13');
  });
  it('utilise le jour local lorsque UTC est encore la veille', () => expect(localDate(new Date('2026-09-25T23:30:00Z'))).toBe('2026-09-26'));
  it('respecte les jours éligibles', () => expect(rightDates('2026-09-21', '2026-09-27', [1,2,3,4,5,6])).toHaveLength(6));
  it('refuse une date inexistante', () => expect(() => endDate('2026-02-31')).toThrow());
});
