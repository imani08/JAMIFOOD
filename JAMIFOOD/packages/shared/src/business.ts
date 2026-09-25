export function localDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kinshasa', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function endDate(start: string, days = 30): string {
  const date = new Date(start + 'T00:00:00Z');
  if (!Number.isInteger(days) || days < 1 || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== start) throw new Error('Date ou durée invalide');
  date.setUTCDate(date.getUTCDate() + days - 1);
  return date.toISOString().slice(0, 10);
}
export function rightDates(start: string, end: string, days: number[]) {
  const result: string[] = [];
  for (let d = new Date(start + 'T00:00:00Z'); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (days.includes(d.getUTCDay())) result.push(d.toISOString().slice(0, 10));
  }
  return result;
}
