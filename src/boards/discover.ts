import { isPostingShape } from '../select.ts';
import { decodeEntities, firstLine, htmlToText } from '../text.ts';
import type { Comment } from '../sources/hn.ts';

export type Platform = 'ashby' | 'greenhouse' | 'lever';

export interface Board {
  platform: Platform;
  slug: string;
  company: string;
}

const PATTERNS: readonly [Platform, RegExp][] = [
  ['ashby', /jobs\.ashbyhq\.com\/([^/?#&"'\s<>]+)/gi],
  ['greenhouse', /(?:boards|job-boards)\.greenhouse\.io\/(?:embed\/job_(?:board|app)\?for=)?([^/?#&"'\s<>]+)/gi],
  ['lever', /jobs\.lever\.co\/([^/?#&"'\s<>]+)/gi],
];

// The slug is interpolated into API and job URLs, so it is held to a strict shape.
const SLUG = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const RESERVED = new Set(['embed']);
const COMPANY_MAX = 60;

export function isValidSlug(slug: string): boolean {
  return SLUG.test(slug) && !RESERVED.has(slug);
}

/** Board links in one comment's HTML. Algolia encodes `/` as `&#x2F;`, so entities are decoded first. */
export function extractBoards(html: string): { platform: Platform; slug: string }[] {
  const text = decodeEntities(html);
  const found: { platform: Platform; slug: string }[] = [];
  for (const [platform, pattern] of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const slug = match[1]?.toLowerCase();
      if (slug && isValidSlug(slug)) found.push({ platform, slug });
    }
  }
  return found;
}

function companyOf(line: string): string {
  const name = line.split(/\||—| - /)[0]?.trim() ?? '';
  return Array.from(name).slice(0, COMPANY_MAX).join('').trim();
}

/**
 * Boards linked from postings. Pass comments newest first: the first posting to link a board
 * names the company, so a renamed company shows its current name.
 */
export function discover(comments: readonly Comment[]): Board[] {
  const boards = new Map<string, Board>();
  for (const comment of comments) {
    const line = firstLine(htmlToText(comment.html));
    if (!isPostingShape(line)) continue;
    const company = companyOf(line);
    if (!company) continue;
    for (const { platform, slug } of extractBoards(comment.html)) {
      const key = `${platform}:${slug}`;
      if (!boards.has(key)) boards.set(key, { platform, slug, company });
    }
  }
  return [...boards.values()];
}
