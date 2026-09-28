import { describe, expect, it } from 'vitest';
import { drcPublicHolidays, endDate, isServiceDay, localDate, rightDates, serviceEndDate, serviceRightDates } from './business';
describe('calendrier Kinshasa', () => {
  it('termine à D+29 y compris sur une année bissextile', () => {
    expect(endDate('2024-02-01')).toBe('2024-03-01');
    expect(endDate('2026-12-15')).toBe('2027-01-13');
  });
  it('utilise le jour local lorsque UTC est encore la veille', () => expect(localDate(new Date('2026-09-25T23:30:00Z'))).toBe('2026-09-26'));
  it('respecte les jours éligibles', () => expect(rightDates('2026-09-21', '2026-09-27', [1,2,3,4,5,6])).toHaveLength(6));
  it('refuse une date inexistante', () => expect(() => endDate('2026-02-31')).toThrow());
  it('calcule 30 jours ouvrés hors jours fériés et fermetures', () => {
    expect(isServiceDay('2026-05-01')).toBe(false);
    expect(isServiceDay('2026-09-29', ['2026-09-29'])).toBe(false);
    expect(serviceEndDate('2026-04-30', 2)).toBe('2026-05-04');
    expect(serviceEndDate('2026-09-28', 2, ['2026-09-29'])).toBe('2026-09-30');
    expect(serviceRightDates('2026-09-28', '2026-10-02', [1,2,3,4,5])).toEqual(['2026-09-28','2026-09-30','2026-10-01','2026-10-02']);
    expect(drcPublicHolidays(2026)).toContain('2026-05-01');
  });
});
