import { describe, expect, it } from 'vitest';
import { apiUrl, jobUrl, parseBoard } from '../src/boards/ats.ts';
import { discover, extractBoards, isValidSlug, type Board } from '../src/boards/discover.ts';
import { buildSnapshot, parseSnapshot, SNAPSHOT_KEY } from '../src/boards/snapshot.ts';
import { boards as boardsAdapter } from '../src/sources/boards.ts';
import { topLevelComments } from '../src/sources/hn.ts';
import { SourceError, type Deps } from '../src/types.ts';
import { fixture, META, minutesAgo, NOW } from './helpers.ts';

const UUID = '0fbdba93-57e9-4833-bdc4-aee539ecda14';
const board = (platform: Board['platform']): Board => META.boards.find((b) => b.platform === platform)!;

describe('discovery', () => {
  it.each([
    ['ashby', 'Apply: <a href="https:&#x2F;&#x2F;jobs.ashbyhq.com&#x2F;Acme&#x2F;123">x</a>', 'acme'],
    ['greenhouse', 'https://boards.greenhouse.io/acme/jobs/1', 'acme'],
    ['greenhouse', 'https://job-boards.greenhouse.io/acme', 'acme'],
    ['greenhouse', 'https://boards.greenhouse.io/embed/job_board?for=acme&b=x', 'acme'],
    ['greenhouse', 'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1', 'acme'],
    ['lever', 'https://jobs.lever.co/acme-inc/abc', 'acme-inc'],
  ])('finds %s links: %s', (platform, html, slug) => {
    expect(extractBoards(html)).toEqual([{ platform, slug }]);
  });

  it('rejects slugs that do not fit the strict shape', () => {
    expect(isValidSlug('acme%20inc')).toBe(false);
    expect(isValidSlug('-acme')).toBe(false);
    expect(isValidSlug('embed')).toBe(false);
    expect(isValidSlug('a'.repeat(65))).toBe(false);
    expect(extractBoards('https://jobs.ashbyhq.com/Acme%20Inc/1')).toEqual([]);
  });

  it('names the company from the newest posting and dedupes boards', () => {
    const comments = [
      { id: '2', created_at: '2026-10-02T00:00:00Z', html: 'Acme AI | Backend | REMOTE<p>https://jobs.ashbyhq.com/acme' },
      { id: '1', created_at: '2026-09-02T00:00:00Z', html: 'Acme Labs | Backend | REMOTE<p>https://jobs.ashbyhq.com/acme' },
    ];
    expect(discover(comments)).toEqual([{ platform: 'ashby', slug: 'acme', company: 'Acme AI' }]);
  });

  it('ignores links in comments that are not postings', () => {
    expect(discover([{ id: '1', created_at: '2026-10-02T00:00:00Z', html: 'I applied via https://jobs.lever.co/acme' }])).toEqual([]);
  });

  it('discovers boards from the fixture thread', () => {
    const found = discover(topLevelComments(fixture('hn-comments.json'), META.thread.id));
    expect(new Set(found.map((b) => b.platform))).toEqual(new Set(['ashby', 'greenhouse', 'lever']));
  });
});

describe('ATS urls', () => {
  it('builds API urls per platform', () => {
    expect(apiUrl({ platform: 'ashby', slug: 'acme', company: 'Acme' })).toBe('https://api.ashbyhq.com/posting-api/job-board/acme');
    expect(apiUrl({ platform: 'greenhouse', slug: 'acme', company: 'Acme' })).toBe('https://boards-api.greenhouse.io/v1/boards/acme/jobs');
    expect(apiUrl({ platform: 'lever', slug: 'acme', company: 'Acme' })).toBe('https://api.lever.co/v0/postings/acme?mode=json');
  });

  it('builds job urls from validated ids only', () => {
    expect(jobUrl('ashby', 'acme', UUID)).toBe(`https://jobs.ashbyhq.com/acme/${UUID}`);
    expect(jobUrl('greenhouse', 'acme', '4000000001')).toBe('https://job-boards.greenhouse.io/acme/jobs/4000000001');
    expect(jobUrl('lever', 'acme', UUID)).toBe(`https://jobs.lever.co/acme/${UUID}`);
    expect(jobUrl('ashby', 'acme', '../evil')).toBeNull();
    expect(jobUrl('greenhouse', 'acme', '12a')).toBeNull();
    expect(jobUrl('lever', 'acme', 'javascript:alert(1)')).toBeNull();
  });
});

describe('ATS parsers', () => {
  it.each(['ashby', 'greenhouse', 'lever'] as const)('parses the %s fixture', (platform) => {
    const posts = parseBoard(board(platform), fixture(`${platform}.json`));
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) {
      expect(p.id.startsWith(`boards:${platform}:${board(platform).slug}:`)).toBe(true);
      expect(p.where).toBe(`${board(platform).company} careers`);
      expect(p.title.startsWith(`${board(platform).company} | `)).toBe(true);
      expect(Number.isFinite(Date.parse(p.posted_at))).toBe(true);
    }
  });

  it('ashby: workplaceType decides over isRemote, which Ashby sets on hybrid roles', () => {
    const json = {
      jobs: [
        { id: UUID, title: 'A', location: 'NYC', publishedAt: '2026-10-01T00:00:00Z', isRemote: true, workplaceType: 'Hybrid' },
        { id: UUID.replace('0', '1'), title: 'B', publishedAt: '2026-10-01T00:00:00Z', isRemote: true, workplaceType: 'Remote' },
        { id: UUID.replace('0', '2'), title: 'C', publishedAt: '2026-10-01T00:00:00Z', isRemote: true },
        { id: UUID.replace('0', '3'), title: 'D', publishedAt: '2026-10-01T00:00:00Z' },
      ],
    };
    expect(parseBoard(board('ashby'), json).map((p) => p.remote)).toEqual([false, true, true, undefined]);
  });

  it('ashby: drops unlisted jobs and jobs with no publish time', () => {
    const json = {
      jobs: [
        { id: UUID, title: 'A', publishedAt: '2026-10-01T00:00:00Z', isListed: false },
        { id: UUID, title: 'B', updatedAt: '2026-10-01T00:00:00Z' },
      ],
    };
    expect(parseBoard(board('ashby'), json)).toEqual([]);
  });

  it('greenhouse: never falls back to updated_at', () => {
    const json = { jobs: [{ id: 1, title: 'A', location: { name: 'Remote' }, updated_at: '2026-10-07T00:00:00Z' }] };
    expect(parseBoard(board('greenhouse'), json)).toEqual([]);
  });

  it('greenhouse: remote is decided by the location text', () => {
    const json = {
      jobs: [
        { id: 1, title: 'Senior Backend Engineer', location: { name: 'Remote-US' }, first_published: minutesAgo(60) },
        { id: 2, title: 'Senior Backend Engineer', location: { name: 'Boston, MA' }, first_published: minutesAgo(60) },
      ],
    };
    const posts = parseBoard(board('greenhouse'), json);
    expect(posts.map((p) => p.remote)).toEqual([undefined, undefined]);
    expect(posts[0]?.title).toBe(`${board('greenhouse').company} | Senior Backend Engineer | Remote-US`);
    expect(posts.map((p) => p.id)).toEqual([`boards:greenhouse:${board('greenhouse').slug}:1`, `boards:greenhouse:${board('greenhouse').slug}:2`]);
  });

  it('lever: workplaceType or a remote location mark it remote; createdAt is epoch ms', () => {
    const json = [
      { id: UUID, text: 'A', createdAt: Date.parse('2026-10-01T00:00:00Z'), workplaceType: 'remote', categories: {} },
      { id: UUID, text: 'B', createdAt: Date.parse('2026-10-01T00:00:00Z'), workplaceType: 'unspecified', categories: { location: 'Remote - EU' } },
      { id: UUID, text: 'C', createdAt: Date.parse('2026-10-01T00:00:00Z'), workplaceType: 'onsite', categories: { location: 'Boulder, CO' } },
      { id: UUID, text: 'D', createdAt: 'yesterday' },
    ];
    const posts = parseBoard(board('lever'), json);
    expect(posts.map((p) => p.remote)).toEqual([true, true, false]);
    expect(posts[0]?.posted_at).toBe('2026-10-01T00:00:00.000Z');
  });

  it('drops jobs whose id cannot build a safe url', () => {
    const json = { jobs: [{ id: 'not-a-uuid', title: 'A', publishedAt: '2026-10-01T00:00:00Z', workplaceType: 'Remote' }] };
    expect(parseBoard(board('ashby'), json)).toEqual([]);
  });

  it.each(['ashby', 'greenhouse', 'lever'] as const)('%s: a wrong response shape is a schema error', (platform) => {
    expect(() => parseBoard(board(platform), platform === 'lever' ? { jobs: [] } : [])).toThrow(SourceError);
  });
});

describe('snapshot', () => {
  const fixtures: Record<string, unknown> = {
    ashby: fixture('ashby.json'),
    greenhouse: fixture('greenhouse.json'),
    lever: fixture('lever.json'),
  };

  it('selects remote roles across boards', async () => {
    const run = await buildSnapshot(META.boards, async (b) => fixtures[b.platform], NOW);
    expect(run.writable).toBe(true);
    expect(run.snapshot.boards_ok).toBe(3);
    expect(run.snapshot.items.length).toBeGreaterThan(0);
    expect(run.snapshot.items.every((i) => i.source === 'boards' && !('body' in i))).toBe(true);
    expect(run.snapshot.generated).toBe(NOW.toISOString());
  });

  it('is writable at exactly half the boards answering', async () => {
    const two = META.boards.slice(0, 2);
    const run = await buildSnapshot(two, async (b) => {
      if (b.platform === 'ashby') throw new SourceError('503');
      return fixtures[b.platform];
    }, NOW);
    expect(run.writable).toBe(true);
    expect(run.failures).toEqual([{ board: two[0], error: '503' }]);
  });

  it('keeps last good: not writable when under half the boards answer', async () => {
    const run = await buildSnapshot(META.boards, async (b) => {
      if (b.platform !== 'lever') throw new SourceError('timeout');
      return fixtures[b.platform];
    }, NOW);
    expect(run.snapshot.boards_ok).toBe(1);
    expect(run.writable).toBe(false);
  });

  it('is not writable with no boards at all', async () => {
    expect((await buildSnapshot([], async () => null, NOW)).writable).toBe(false);
  });

  it('counts a board with a malformed response as failed', async () => {
    const run = await buildSnapshot([board('lever')], async () => ({ not: 'a list' }), NOW);
    expect(run.failures[0]?.error).toBe('schema');
  });

  it('respects the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const many = Array.from({ length: 20 }, (_, i) => ({ platform: 'lever' as const, slug: `s${i}`, company: 'C' }));
    await buildSnapshot(many, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return [];
    }, NOW, 6);
    expect(peak).toBe(6);
  });

  it('validates what it reads back, dropping items with foreign urls', () => {
    const snap = parseSnapshot({
      generated: NOW.toISOString(),
      boards_total: 2,
      boards_ok: 2,
      items: [
        { id: 'boards:lever:a:1', where: 'A careers', title: 'A | x', posted_at: NOW.toISOString(), url: `https://jobs.lever.co/a/${UUID}` },
        { id: 'boards:lever:a:2', where: 'A careers', title: 'A | x', posted_at: NOW.toISOString(), url: 'javascript:alert(1)' },
        { id: 'hn:3', where: 'x', title: 'x', posted_at: NOW.toISOString(), url: 'https://jobs.lever.co/a/b' },
      ],
    });
    expect(snap.items.map((i) => i.id)).toEqual(['boards:lever:a:1']);
    expect(() => parseSnapshot({ items: [] })).toThrow(SourceError);
  });
});

describe('boards source (KV)', () => {
  const item = {
    id: 'boards:lever:a:1',
    source: 'boards',
    where: 'A careers',
    title: 'A | Backend | Remote',
    posted_at: minutesAgo(120),
    url: `https://jobs.lever.co/a/${UUID}`,
  };

  function depsWith(snapshot: unknown): Deps {
    return {
      fetch: (() => Promise.reject(new Error('no network'))) as unknown as typeof fetch,
      now: NOW,
      userAgent: 'test',
      kv: { get: (async (key: string) => (key === SNAPSHOT_KEY ? snapshot : null)) as never },
    };
  }

  const snapshotAged = (hours: number) => ({ generated: minutesAgo(hours * 60), boards_total: 1, boards_ok: 1, items: [item] });

  it('is ok with a fresh snapshot and reports its generated time', async () => {
    const loaded = await boardsAdapter.load(depsWith(snapshotAged(3)));
    expect(loaded.error).toBeUndefined();
    expect(loaded.posts).toHaveLength(1);
    expect(loaded.fetched_at).toBe(minutesAgo(180));
  });

  it('is stale but keeps items past 9h', async () => {
    const loaded = await boardsAdapter.load(depsWith(snapshotAged(10)));
    expect(loaded.error).toBe('stale');
    expect(loaded.posts).toHaveLength(1);
  });

  it('drops items past 24h', async () => {
    const loaded = await boardsAdapter.load(depsWith(snapshotAged(25)));
    expect(loaded.error).toBe('stale');
    expect(loaded.posts).toEqual([]);
  });

  it('fails when there is no snapshot yet', async () => {
    await expect(boardsAdapter.load(depsWith(null))).rejects.toMatchObject({ code: 'no snapshot' });
  });

  it('fails with schema on a corrupt snapshot', async () => {
    await expect(boardsAdapter.load(depsWith({ generated: 'nope', items: [] }))).rejects.toMatchObject({ code: 'schema' });
  });
});
