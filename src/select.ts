import { DENY_PHRASES } from './deny.ts';
import { truncate } from './text.ts';
import type { Candidate, Item } from './types.ts';

export const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const CAP = 300;
export const TITLE_MAX = 160;
/** Tolerated clock skew for posts timestamped slightly ahead of us. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const SHAPE_PREFIX = 200;
const BODY_REMOTE_WINDOW = 500;

const REMOTE_TERMS = ['remote', 'remotely', 'wfh', 'work from home', 'anywhere', 'fully distributed', 'distributed team'];
const NOT_REMOTE_TERMS = ['not remote', 'no remote', 'non-remote', 'non remote', 'onsite only', 'on-site only'];

/** Separators between the fields of an HN posting header. */
export const SEPARATOR = /\||\u2014| - /;

function phraseMatcher(phrases: readonly string[]): (text: string) => boolean {
  const escaped = phrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
  const re = new RegExp(`(?:^|[^a-z0-9])(?:${escaped.join('|')})(?![a-z0-9])`, 'i');
  return (text) => re.test(text);
}

const isDeniedText = phraseMatcher(DENY_PHRASES);
const hasRemote = phraseMatcher(REMOTE_TERMS);
const hasNotRemote = phraseMatcher(NOT_REMOTE_TERMS);

export function textRemote(text: string): boolean {
  return !hasNotRemote(text) && hasRemote(text);
}

/** HN posting shape: a header like `Acme | Backend Engineer | REMOTE`, not an applicant's reply. */
export function isPostingShape(line: string): boolean {
  return line.slice(0, SHAPE_PREFIX).split(SEPARATOR).filter((s) => s.trim()).length >= 2;
}

export function isDenied(c: Candidate): boolean {
  return isDeniedText(`${c.title}\n${c.body}`);
}

export function isRemote(c: Candidate): boolean {
  switch (c.source) {
    case 'hn':
      return textRemote(c.title);
    case 'yc':
      return textRemote(`${c.title}\n${c.body.slice(0, BODY_REMOTE_WINDOW)}`);
    case 'boards':
      return c.remote ?? textRemote(c.title);
  }
}

function passesPostingGate(c: Candidate): boolean {
  return c.source !== 'hn' || isPostingShape(c.title);
}

/** Gates, window, sort, cap. Input order is source order, which breaks ties. */
export function select(candidates: readonly Candidate[], now: Date): Item[] {
  const t = now.getTime();
  const seen = new Set<string>();
  const kept: { item: Item; ts: number; order: number }[] = [];

  candidates.forEach((c, order) => {
    if (seen.has(c.id) || !passesPostingGate(c) || !isRemote(c)) return;
    const ts = Date.parse(c.posted_at);
    if (!Number.isFinite(ts) || ts > t + FUTURE_SKEW_MS || t - ts > WINDOW_MS) return;
    // Last: the only gate that reads the body, which hn converts on first read.
    if (isDenied(c)) return;
    seen.add(c.id);
    kept.push({
      ts,
      order,
      item: {
        id: c.id,
        source: c.source,
        where: c.where,
        title: truncate(c.title, TITLE_MAX),
        posted_at: new Date(ts).toISOString(),
        url: c.url,
      },
    });
  });

  kept.sort((a, b) => b.ts - a.ts || a.order - b.order);
  return kept.slice(0, CAP).map((k) => k.item);
}
