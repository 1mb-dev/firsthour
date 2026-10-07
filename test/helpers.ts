import { readFileSync } from 'node:fs';
import type { Candidate } from '../src/types.ts';

export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

export const META = fixture('meta.json') as {
  recorded_at: string;
  thread: { id: string; title: string; created_at: string };
  boards: { platform: 'ashby' | 'greenhouse' | 'lever'; slug: string; company: string }[];
};

/** The fixed clock every fixture test runs on: when the fixtures were recorded. */
export const NOW = new Date(META.recorded_at);

export function minutesAgo(m: number, now = NOW): string {
  return new Date(now.getTime() - m * 60_000).toISOString();
}

export function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'hn:1',
    source: 'hn',
    where: 'HN Who is hiring (Oct)',
    title: 'Acme | Senior Backend Engineer | REMOTE (EU) | Full-time',
    posted_at: minutesAgo(10),
    url: 'https://news.ycombinator.com/item?id=1',
    body: '',
    ...overrides,
  };
}
