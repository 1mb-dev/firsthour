import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { age, allDown, group, isNew, isRead, loadSeen, loadTheme, matches, nextSeen, parseFilter, parts, saveSeen, saveTheme, sourceLabel, statusText } from '../public/lib.js';

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

  it('matches whole words in company or role, any include, no exclude', () => {
    const f = parseFilter('go, rust, -onsite');
    expect(matches(item('1', 0, 'Acme | Go Engineer | Remote'), f)).toBe(true);
    expect(matches(item('2', 0, 'Acme | Google Ads | Remote'), f)).toBe(false);
    expect(matches(item('3', 0, 'Acme | Engineer | Chicago'), f)).toBe(false);
    expect(matches(item('4', 0, 'Acme | Rust | Remote or onsite'), f)).toBe(false);
  });

  it('never matches text a row does not show: URLs, where, or the source word', () => {
    const board = { ...item('1', 0, 'Acme | Engineer | Remote', 'Acme careers'), source: 'boards' as const };
    expect(matches(board, parseFilter('board'))).toBe(false);
    expect(matches(board, parseFilter('careers'))).toBe(false);
    expect(matches(item('2', 0), parseFilter('-hiring'))).toBe(true);
    expect(matches(item('3', 0, 'Acme | Engineer | Remote | https://jobs.lever.co/acme'), parseFilter('-lever'))).toBe(true);
    const story = { ...item('4', 0, 'Acme (YC W22) is hiring a backend engineer', 'HN jobs'), source: 'yc' as const };
    expect(matches(story, parseFilter('-hn'))).toBe(true);
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

  it('marks nothing new and nothing read on a first visit', () => {
    const seen = loadSeen(memory());
    expect(seen).toBeNull();
    expect(isNew(item('a', 0), seen)).toBe(false);
    expect(isRead(item('a', 0), seen)).toBe(false);
  });

  it('keeps arrival and reading apart: listed but never on screen is neither new nor read', () => {
    const seen = loadSeen(memory(JSON.stringify({ ids: ['listed', 'read'], read: ['read'], at: ago(60 * MIN) })));
    expect([isNew(item('listed', 0), seen), isRead(item('listed', 0), seen)]).toEqual([false, false]);
    expect([isNew(item('read', 0), seen), isRead(item('read', 0), seen)]).toEqual([false, true]);
    expect([isNew(item('arrived', 0), seen), isRead(item('arrived', 0), seen)]).toEqual([true, false]);
  });

  it('reads a record from before `read` existed as all read', () => {
    const seen = loadSeen(memory(JSON.stringify({ ids: ['a'], at: ago(60 * MIN) })));
    expect(isRead(item('a', 0), seen)).toBe(true);
    expect(isRead(item('b', 0), seen)).toBe(false);
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

  it('keeps filtered-out items unseen, rows never on screen unread, and prunes ids no longer listed', () => {
    const seen = { ids: new Set(['old', 'gone']), read: new Set(['old', 'gone']), at: ago(MIN) };
    const next = nextSeen(seen, ['old', 'new', 'below', 'hidden'], ['new', 'below'], ['new']);
    expect(next.ids.sort()).toEqual(['below', 'new', 'old']);
    expect(next.read.sort()).toEqual(['new', 'old']);
  });

  it('round-trips through storage and survives a throwing setItem', () => {
    const store = memory();
    saveSeen(store, { ids: ['a', 'b'], read: ['a'] }, new Date(NOW));
    const loaded = loadSeen(store);
    expect([loaded?.ids.has('b'), loaded?.read.has('a'), loaded?.read.has('b')]).toEqual([true, true, false]);
    expect(() => saveSeen({ setItem: () => { throw new Error('full'); } }, { ids: ['a'], read: [] }, new Date(NOW))).not.toThrow();
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

describe('parts', () => {
  const hn = (title: string, source: 'hn' | 'yc' | 'boards' = 'hn') => ({ ...item('x', MIN, title), source });
  it.each([
    ['Acme | Backend Engineer | Remote', { company: 'Acme', role: 'Backend Engineer · Remote' }],
    ['Acme|Backend Engineer|REMOTE (US)', { company: 'Acme', role: 'Backend Engineer · REMOTE (US)' }],
    ['Acme | https://acme.example/jobs | REMOTE (US) | Full Time', { company: 'Acme', role: 'REMOTE (US) · Full Time' }],
    ['Acme (https://acme.example) | Go Engineer', { company: 'Acme', role: 'Go Engineer' }],
    ['Acme | www.acme.example | Remote', { company: 'Acme', role: 'Remote' }],
    ['Acme | Staff Engineer | Remote | https:…', { company: 'Acme', role: 'Staff Engineer · Remote' }],
    ['Acme | Staff Engineer | Remote (https://acme.example/careers/staff-eng…', { company: 'Acme', role: 'Staff Engineer · Remote' }],
    ['Acme | Engineer | REMOTE (http…', { company: 'Acme', role: 'Engineer · REMOTE' }],
    ['Acme | Engineer | REMOTE ww…', { company: 'Acme', role: 'Engineer · REMOTE' }],
    ['Acme | Engineer | Hybrid…', { company: 'Acme', role: 'Engineer · Hybrid…' }],
    ['www.acme.io | Senior Go Engineer | Remote', { company: '', role: 'Senior Go Engineer · Remote' }],
    ['Acme | Node.js Engineer | Remote', { company: 'Acme', role: 'Node.js Engineer · Remote' }],
    ['Acme | REMOTE in select countries (listed here https://wiki.example/p/a_9) | $181K', { company: 'Acme', role: 'REMOTE in select countries (listed here) · $181K' }],
    ['Software Engineer — Remote — US Only', { company: '', role: 'Software Engineer — Remote — US Only' }],
  ])('%s', (title, expected) => {
    expect(parts(hn(title))).toEqual(expected);
  });

  it('gives HN job stories no company part', () => {
    expect(parts(hn('Acme (YC W22) | is hiring a backend engineer', 'yc'))).toEqual({ company: '', role: 'Acme (YC W22) · is hiring a backend engineer' });
  });

  it('keeps the raw title when nothing but URLs is left', () => {
    expect(parts(hn('https://acme.example'))).toEqual({ company: '', role: 'https://acme.example' });
  });
});

describe('sourceLabel', () => {
  it.each([
    ['hn', 'HN'],
    ['yc', 'HN jobs'],
    ['boards', 'board'],
  ] as const)('%s -> %s', (source, label) => {
    expect(sourceLabel({ ...item('x', MIN), source })).toBe(label);
  });
});

describe('theme', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      removeItem: (k: string) => void data.delete(k),
    };
  };
  const broken = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
    removeItem: () => {
      throw new Error('denied');
    },
  };

  it('round-trips a choice; auto clears it', () => {
    const storage = memory();
    expect(loadTheme(storage)).toBe('auto');
    saveTheme(storage, 'dark');
    expect(loadTheme(storage)).toBe('dark');
    saveTheme(storage, 'auto');
    expect(storage.getItem('firsthour:theme')).toBeNull();
    expect(loadTheme(storage)).toBe('auto');
  });

  it('falls back to auto on blocked storage or an unknown value', () => {
    expect(loadTheme(broken)).toBe('auto');
    expect(() => saveTheme(broken, 'light')).not.toThrow();
    expect(loadTheme(undefined)).toBe('auto');
    const storage = memory();
    storage.setItem('firsthour:theme', 'sepia');
    expect(loadTheme(storage)).toBe('auto');
  });

  // theme.js is a classic script (it must run before first paint), so it cannot import lib.js.
  it('theme.js applies what saveTheme stored, and nothing else', () => {
    const source = readFileSync(new URL('../public/theme.js', import.meta.url), 'utf8');
    const run = (storage: unknown) => {
      const documentElement = { dataset: {} as Record<string, string> };
      new Function('localStorage', 'document', source)(storage, { documentElement });
      return documentElement.dataset.theme;
    };
    for (const theme of ['light', 'dark'] as const) {
      const storage = memory();
      saveTheme(storage, theme);
      expect(run(storage)).toBe(theme);
    }
    const storage = memory();
    storage.setItem('firsthour:theme', 'sepia');
    expect(run(storage)).toBeUndefined();
    expect(run(broken)).toBeUndefined();
  });
});
