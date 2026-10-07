import { describe, expect, it } from 'vitest';
import { nextThread, threadTime } from '../src/next-thread.ts';

describe('threadTime', () => {
  // Observed 2026 thread times, from Algolia.
  it.each([
    [0, '2026-01-02T16:00:00.000Z'], // Jan 1 skipped
    [1, '2026-02-02T16:00:00.000Z'], // Feb 1 is a Sunday
    [2, '2026-03-02T16:00:00.000Z'], // before US daylight time starts Mar 8
    [3, '2026-04-01T15:00:00.000Z'],
    [7, '2026-08-03T15:00:00.000Z'], // Aug 1 is a Saturday
    [9, '2026-10-01T15:00:00.000Z'],
    [10, '2026-11-02T16:00:00.000Z'], // daylight time ended Nov 1
  ])('2026 month %i -> %s', (month, iso) => {
    expect(threadTime(2026, month).toISOString()).toBe(iso);
  });
});

describe('nextThread', () => {
  it('is this month when its thread is still ahead', () => {
    expect(nextThread(new Date('2026-10-01T14:00:00Z')).toISOString()).toBe('2026-10-01T15:00:00.000Z');
  });

  it('is next month once this month has passed', () => {
    expect(nextThread(new Date('2026-10-07T16:00:00Z'), '2026-10-01T15:02:07Z').toISOString()).toBe('2026-11-02T16:00:00.000Z');
  });

  it('skips this month when its thread is already out early', () => {
    expect(nextThread(new Date('2026-10-01T14:58:00Z'), '2026-10-01T14:55:00Z').toISOString()).toBe('2026-11-02T16:00:00.000Z');
  });

  it('rolls over the year and skips Jan 1', () => {
    expect(nextThread(new Date('2026-12-15T00:00:00Z'), '2026-12-01T16:00:00Z').toISOString()).toBe('2027-01-04T16:00:00.000Z');
  });
});
