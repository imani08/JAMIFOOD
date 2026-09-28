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

// Jours fériés légaux en RDC selon l'ordonnance n°23/042 du 30 mars 2023.
// Le 6 avril (Journée du combat de Simon Kimbangu) est inclus.
export function drcPublicHolidays(year: number): string[] {
  const dates = [
    `${year}-01-01`, `${year}-01-04`, `${year}-01-16`, `${year}-01-17`,
    `${year}-04-06`, `${year}-05-01`, `${year}-05-17`, `${year}-06-30`,
    `${year}-08-01`, `${year}-12-25`,
  ];
  // Les jours fériés tombant un dimanche sont observés le samedi précédent.
  for (const date of [...dates]) {
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) {
      const observed = new Date(`${date}T00:00:00Z`);
      observed.setUTCDate(observed.getUTCDate() - 1);
      dates.push(observed.toISOString().slice(0, 10));
    }
  }
  return [...new Set(dates)].sort();
}

export function isServiceDay(date: string, closures: string[] = []): boolean {
  const value = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) throw new Error('Date invalide');
  const weekday = value.getUTCDay();
  return weekday >= 1 && weekday <= 5 &&
    !drcPublicHolidays(value.getUTCFullYear()).includes(date) &&
    !closures.includes(date);
}

export function serviceEndDate(start: string, serviceDays = 30, closures: string[] = []): string {
  const date = new Date(`${start}T00:00:00Z`);
  if (!Number.isInteger(serviceDays) || serviceDays < 1 || serviceDays > 366 || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== start) throw new Error('Date ou durée invalide');
  let counted = 0;
  for (let scanned = 0; scanned < 1100; scanned++, date.setUTCDate(date.getUTCDate() + 1)) {
    const current = date.toISOString().slice(0, 10);
    if (isServiceDay(current, closures) && ++counted === serviceDays) return current;
  }
  throw new Error('Impossible de calculer la fin de service');
}

export function serviceRightDates(start: string, end: string, eligibleDays: number[], closures: string[] = []): string[] {
  return rightDates(start, end, eligibleDays).filter(date => isServiceDay(date, closures));
}
