import { describe, expect, it } from 'vitest';
import { age, allDown, group, isNew, loadSeen, matches, nextSeen, parseFilter, saveSeen, statusText } from '../public/lib.js';

const NOW = Date.parse('2026-10-07T16:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const item = (id: string, postedAgo: number, title = 'Acme | Backend Engineer | Remote', where = 'HN Who is hiring (Oct)') => ({
  id,
  source: 'hn' as const,
  where,
  title,
  posted_at: ago(postedAgo),
  url: `https://news.ycombinator.com/item?id=${id}`,
});

describe('age', () => {
  it.each([
    [10_000, 'now'],
    [12 * MIN, '12m'],
    [3 * 60 * MIN, '3h'],
    [2 * 24 * 60 * MIN, '2d'],
    [-5 * MIN, 'now'],
  ])('%i ms ago -> %s', (ms, label) => {
    expect(age(ago(ms), NOW)).toBe(label);
  });
});

describe('group', () => {
  it('splits by the hour and day boundaries and hides empty groups', () => {
    const groups = group([item('a', 59 * MIN), item('b', 60 * MIN), item('c', 3 * 24 * 60 * MIN)], NOW);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['First hour', ['a']],
      ['Last 24 hours', ['b']],
      ['This week', ['c']],
    ]);
    expect(group([item('c', 3 * 24 * 60 * MIN)], NOW).map((g) => g.label)).toEqual(['This week']);
  });
});

describe('filter', () => {
  it('parses includes and excludes, ignoring blanks and case', () => {
    expect(parseFilter(' Go, backend ,, -Onsite, - ')).toEqual({ include: ['go', 'backend'], exclude: ['onsite'] });
  });

  it('matches whole words in title or where, any include, no exclude', () => {
    const f = parseFilter('go, rust, -onsite');
    expect(matches(item('1', 0, 'Acme | Go Engineer | Remote'), f)).toBe(true);
    expect(matches(item('2', 0, 'Acme | Google Ads | Remote'), f)).toBe(false);
    expect(matches(item('3', 0, 'Acme | Engineer | Chicago'), f)).toBe(false);
    expect(matches(item('4', 0, 'Acme | Rust | Remote or onsite'), f)).toBe(false);
    expect(matches(item('5', 0, 'Acme | Engineer', 'Rust Co careers'), f)).toBe(true);
  });

  it('accepts a plural', () => {
    expect(matches(item('1', 0, 'Globex | Sr/Staff Software Engineers | REMOTE'), parseFilter('engineer'))).toBe(true);
    expect(matches(item('2', 0, 'Acme | Engineering Manager | REMOTE'), parseFilter('engineer'))).toBe(false);
  });

  it('handles terms with symbols', () => {
    expect(matches(item('1', 0, 'Acme | C++ Engineer | Remote'), parseFilter('c++'))).toBe(true);
    expect(matches(item('2', 0, 'Acme | Node.js | Remote'), parseFilter('node.js'))).toBe(true);
  });

  it('an empty filter matches everything', () => {
    expect(matches(item('1', 0), parseFilter(''))).toBe(true);
  });
});

describe('new since last visit', () => {
  function memory(initial?: string) {
    const data = new Map<string, string>(initial ? [['firsthour:seen', initial]] : []);
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  }

  it('marks nothing new on a first visit', () => {
    const seen = loadSeen(memory());
    expect(seen).toBeNull();
    expect(isNew(item('a', 0), seen)).toBe(false);
  });

  it('marks unseen ids new on a return visit', () => {
    const seen = loadSeen(memory(JSON.stringify({ ids: ['a'], at: ago(60 * MIN) })));
    expect(isNew(item('a', 0), seen)).toBe(false);
    expect(isNew(item('b', 0), seen)).toBe(true);
  });

  it('treats corrupt or throwing storage as a first visit', () => {
    expect(loadSeen(memory('{nope'))).toBeNull();
    expect(loadSeen(memory(JSON.stringify({ ids: 'a' })))).toBeNull();
    expect(loadSeen({ getItem: () => { throw new Error('denied'); } })).toBeNull();
    expect(loadSeen(undefined)).toBeNull();
  });

  it('keeps filtered-out items unseen and prunes ids no longer listed', () => {
    const seen = { ids: new Set(['old', 'gone']), at: ago(MIN) };
    expect(nextSeen(seen, ['old', 'new', 'hidden'], ['new']).sort()).toEqual(['new', 'old']);
  });

  it('round-trips through storage and survives a throwing setItem', () => {
    const store = memory();
    saveSeen(store, ['a'], new Date(NOW));
    expect(loadSeen(store)?.ids.has('a')).toBe(true);
    expect(() => saveSeen({ setItem: () => { throw new Error('full'); } }, ['a'], new Date(NOW))).not.toThrow();
  });
});

describe('status', () => {
  const time = (iso: string) => iso.slice(11, 16);

  it.each([
    [{ id: 'hn', ok: true, error: null }, 'HN ok'],
    [{ id: 'yc', ok: false, error: '429' }, 'HN jobs unavailable (429)'],
    [{ id: 'boards', ok: false, error: 'stale' }, 'Boards stale since 14:02'],
  ])('%o -> %s', (s, text) => {
    expect(statusText({ fetched_at: '2026-10-07T14:02:00Z', count: 0, ...s }, time)).toBe(text);
  });

  it('allDown only when every source failed and nothing is left to show', () => {
    const down = { id: 'hn', ok: false, fetched_at: '', error: '503', count: 0 };
    const base = { generated: '', stale: false, next_thread: '', sources: [down], items: [] };
    expect(allDown(base)).toBe(true);
    expect(allDown({ ...base, items: [item('a', 0)] })).toBe(false);
    expect(allDown({ ...base, sources: [{ ...down, ok: true }] })).toBe(false);
  });
});
