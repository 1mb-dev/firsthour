import { fetchJson, hitsOf, isRecord, str } from '../http.ts';
import { htmlToText } from '../text.ts';
import type { Adapter, Candidate } from '../types.ts';
import { itemUrl } from './hn.ts';

export const JOBS_URL =
  'https://hn.algolia.com/api/v1/search_by_date?tags=job&hitsPerPage=50&attributesToRetrieve=title,story_text,created_at&attributesToHighlight=none';

export function parseJobs(json: unknown): Candidate[] {
  const posts: Candidate[] = [];
  for (const hit of hitsOf(json)) {
    if (!isRecord(hit)) continue;
    const id = str(hit.objectID);
    const title = str(hit.title)?.trim();
    const created = str(hit.created_at);
    if (!id || !/^\d+$/.test(id) || !title || !created) continue;
    posts.push({
      id: `yc:${id}`,
      source: 'yc',
      where: 'HN jobs',
      title,
      posted_at: created,
      url: itemUrl(id),
      body: htmlToText(str(hit.story_text) ?? ''),
    });
  }
  return posts;
}

export const yc: Adapter = {
  id: 'yc',
  async load({ fetch, userAgent }) {
    return { posts: parseJobs(await fetchJson(fetch, JOBS_URL, userAgent, 5000)) };
  },
};
