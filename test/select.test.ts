import { describe, expect, it } from 'vitest';
import { DENY_PHRASES } from '../src/deny.ts';
import { CAP, isPostingShape, select, textRemote, TITLE_MAX } from '../src/select.ts';
import type { Candidate } from '../src/types.ts';
import { candidate, minutesAgo, NOW } from './helpers.ts';

describe('posting gate (hn)', () => {
  it('accepts a pipe-separated header', () => {
    expect(isPostingShape('Acme | Backend Engineer | REMOTE')).toBe(true);
  });

  it('accepts em dash and spaced hyphen separators', () => {
    expect(isPostingShape('Acme — Backend Engineer')).toBe(true);
    expect(isPostingShape('DuckDuckGo - we are looking for candidates')).toBe(true);
  });

  it('rejects an applicant reply posted at top level', () => {
    expect(isPostingShape("I'm applying for the Growth Lead / Expansion & Lifecycle role, specifically the automation piece.")).toBe(false);
  });

  it('rejects commentary with no header', () => {
    expect(isPostingShape('there used to be 800+ posts here :(')).toBe(false);
  });

  it('accepts a header whose first line runs past 200 chars into the body', () => {
    const line = `Acme | Full-Time | Product Engineers | REMOTE (all remote) | ${'Acme makes tools for product engineers. '.repeat(8)}`;
    expect(line.length).toBeGreaterThan(200);
    expect(isPostingShape(line)).toBe(true);
  });

  it('ignores separators beyond the first 200 chars', () => {
    expect(isPostingShape(`${'x'.repeat(201)} | late separator`)).toBe(false);
  });

  it('does not count empty segments', () => {
    expect(isPostingShape('| |')).toBe(false);
  });

  it('applies only to hn: yc and boards titles need no separator', () => {
    const items = select(
      [
        candidate({ id: 'hn:1', title: 'Acme is hiring remote engineers' }),
        candidate({ id: 'yc:2', source: 'yc', title: 'Acme (YC W24) Is Hiring Remote Engineers' }),
        candidate({ id: 'boards:x', source: 'boards', title: 'Acme Backend Engineer', remote: true }),
      ],
      NOW,
    );
    expect(items.map((i) => i.id)).toEqual(['yc:2', 'boards:x']);
  });
});

describe('deny list', () => {
  it.each(DENY_PHRASES)('drops "%s" in the title or the body', (phrase) => {
    expect(select([candidate({ title: `Acme | ${phrase} | REMOTE` })], NOW)).toEqual([]);
    expect(select([candidate({ body: `Note: this is an ${phrase.toUpperCase()} gig.` })], NOW)).toEqual([]);
  });

  it('reads the body only for candidates that pass every other gate', () => {
    const unread = (overrides: Partial<Candidate>) =>
      Object.defineProperty(candidate(overrides), 'body', {
        get: () => {
          throw new Error('body read');
        },
      });
    const dropped = [unread({ title: 'I am applying for this role' }), unread({ title: 'Acme | Engineer | Onsite' }), unread({ posted_at: minutesAgo(8 * 24 * 60) })];
    expect(select(dropped, NOW)).toEqual([]);
  });

  it('matches across extra whitespace', () => {
    expect(select([candidate({ body: 'equity\n  only' })], NOW)).toEqual([]);
  });

  it('keeps near misses that bare words would have dropped', () => {
    const titles = [
      'Ledgerly | Backend Engineer, unpaid invoices team | REMOTE',
      'Riskco | Exposure Management Engineer | REMOTE',
      'Secco | Security Engineer, tooling for exposure management | REMOTE',
      'Acme | Engineer | REMOTE | salary plus equity',
      'Acme | Engineer | REMOTE | we volunteer at local schools',
    ];
    expect(select(titles.map((title, i) => candidate({ id: `hn:${i}`, title })), NOW)).toHaveLength(titles.length);
  });
});

describe('remote gate', () => {
  it.each(['REMOTE', 'Remote-first', 'remotely', 'WFH', 'work from home', 'Anywhere', 'fully distributed', 'distributed team'])(
    'passes on "%s"',
    (term) => {
      expect(textRemote(`Acme | Engineer | ${term}`)).toBe(true);
    },
  );

  it.each(['not remote', 'No remote', 'non-remote', 'Non remote', 'ONSITE ONLY', 'on-site only'])('a "%s" phrase overrides', (phrase) => {
    expect(textRemote(`Acme | Engineer | Remote team, but ${phrase}`)).toBe(false);
  });

  it('does not treat "Distributed Systems" as remote', () => {
    expect(textRemote('Column | Distributed Systems Engineer | ONSITE San Francisco')).toBe(false);
  });

  it('does not match remote inside another word', () => {
    expect(textRemote('Acme | Engineer | Premotech office')).toBe(false);
  });

  it('hn reads the first line (title) only', () => {
    expect(select([candidate({ title: 'Acme | Engineer | NYC', body: 'Acme | Engineer | NYC\nRemote ok' })], NOW)).toEqual([]);
  });

  it('yc reads the title, else the first 500 chars of the body', () => {
    const inBody = candidate({ id: 'yc:1', source: 'yc', title: 'Acme Is Hiring', body: 'We are a remote team.' });
    const tooLate = candidate({ id: 'yc:2', source: 'yc', title: 'Acme Is Hiring', body: `${'x'.repeat(500)} remote` });
    expect(select([inBody, tooLate], NOW).map((i) => i.id)).toEqual(['yc:1']);
  });

  it('boards trust the structured flag and fall back to the text gate', () => {
    const items = select(
      [
        candidate({ id: 'boards:a', source: 'boards', title: 'Acme | Engineer | New York', remote: true }),
        candidate({ id: 'boards:b', source: 'boards', title: 'Acme | Engineer | Remote', remote: false }),
        candidate({ id: 'boards:c', source: 'boards', title: 'Acme | Engineer | Remote-US' }),
        candidate({ id: 'boards:d', source: 'boards', title: 'Acme | Engineer | Boston' }),
      ],
      NOW,
    );
    expect(items.map((i) => i.id)).toEqual(['boards:a', 'boards:c']);
  });
});

describe('age window, sort, cap', () => {
  it('keeps posts up to 7 days old and drops older', () => {
    const items = select(
      [
        candidate({ id: 'hn:new', posted_at: minutesAgo(1) }),
        candidate({ id: 'hn:edge', posted_at: minutesAgo(7 * 24 * 60) }),
        candidate({ id: 'hn:old', posted_at: minutesAgo(7 * 24 * 60 + 1) }),
      ],
      NOW,
    );
    expect(items.map((i) => i.id)).toEqual(['hn:new', 'hn:edge']);
  });

  it('drops invalid and far-future timestamps, tolerates small skew', () => {
    const items = select(
      [
        candidate({ id: 'hn:bad', posted_at: 'not a date' }),
        candidate({ id: 'hn:future', posted_at: minutesAgo(-60) }),
        candidate({ id: 'hn:skew', posted_at: minutesAgo(-2) }),
      ],
      NOW,
    );
    expect(items.map((i) => i.id)).toEqual(['hn:skew']);
  });

  it('sorts newest first and keeps source order on ties', () => {
    const t = minutesAgo(30);
    const items = select(
      [
        candidate({ id: 'hn:older', posted_at: minutesAgo(90) }),
        candidate({ id: 'hn:tie', posted_at: t }),
        candidate({ id: 'yc:tie', source: 'yc', title: 'Acme Is Hiring (Remote)', posted_at: t }),
        candidate({ id: 'hn:newest', posted_at: minutesAgo(5) }),
      ],
      NOW,
    );
    expect(items.map((i) => i.id)).toEqual(['hn:newest', 'hn:tie', 'yc:tie', 'hn:older']);
  });

  it(`caps at ${CAP} items`, () => {
    const many = Array.from({ length: CAP + 20 }, (_, i) => candidate({ id: `hn:${i}`, posted_at: minutesAgo(i) }));
    expect(select(many, NOW)).toHaveLength(CAP);
  });

  it('drops duplicate ids', () => {
    expect(select([candidate(), candidate()], NOW)).toHaveLength(1);
  });
});

describe('output', () => {
  it('truncates titles and never carries body or remote', () => {
    const [item] = select([candidate({ title: `Acme | REMOTE | ${'x'.repeat(300)}`, body: 'secret body' })], NOW);
    expect(item && Array.from(item.title)).toHaveLength(TITLE_MAX);
    expect(item).not.toHaveProperty('body');
    expect(item).not.toHaveProperty('remote');
  });

  it('normalises posted_at to ISO UTC', () => {
    const [item] = select([candidate({ posted_at: '2026-10-07T12:00:00-04:00' })], NOW);
    expect(item?.posted_at).toBe('2026-10-07T16:00:00.000Z');
  });
});
