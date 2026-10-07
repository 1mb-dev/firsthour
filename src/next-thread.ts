// whoishiring posts at 11:00 America/New_York on the first weekday of the month, skipping Jan 1.
// Every 2026 thread through October matches. It is an estimate and the UI labels it so.

const NY_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' });

function firstWeekday(year: number, month: number): number {
  let day = 1;
  for (;;) {
    const weekday = new Date(Date.UTC(year, month, day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !(month === 0 && day === 1)) return day;
    day += 1;
  }
}

/** 11:00 New York time is 15:00 UTC under daylight time and 16:00 UTC otherwise. */
export function threadTime(year: number, month: number): Date {
  const day = firstWeekday(year, month);
  const summer = new Date(Date.UTC(year, month, day, 15));
  return NY_HOUR.format(summer) === '11' ? summer : new Date(Date.UTC(year, month, day, 16));
}

/** The next expected thread after `now`, skipping a month whose thread is already out. */
export function nextThread(now: Date, latestThreadAt?: string): Date {
  const latest = latestThreadAt ? new Date(latestThreadAt) : undefined;
  for (let k = 0; ; k++) {
    const year = now.getUTCFullYear() + Math.floor((now.getUTCMonth() + k) / 12);
    const month = (now.getUTCMonth() + k) % 12;
    const t = threadTime(year, month);
    const alreadyOut = latest?.getUTCFullYear() === year && latest.getUTCMonth() === month;
    if (t > now && !alreadyOut) return t;
  }
}
