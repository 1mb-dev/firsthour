import { isRecord, str } from '../http.ts';
import { SourceError, type Candidate } from '../types.ts';
import type { Board, Platform } from './discover.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC = /^\d{1,20}$/;

export function apiUrl(board: Board): string {
  switch (board.platform) {
    case 'ashby':
      return `https://api.ashbyhq.com/posting-api/job-board/${board.slug}`;
    case 'greenhouse':
      return `https://boards-api.greenhouse.io/v1/boards/${board.slug}/jobs`;
    case 'lever':
      return `https://api.lever.co/v0/postings/${board.slug}?mode=json`;
  }
}

/** Built from a validated id, never read from the response. Null when the id has the wrong shape. */
export function jobUrl(platform: Platform, slug: string, id: string): string | null {
  switch (platform) {
    case 'ashby':
      return UUID.test(id) ? `https://jobs.ashbyhq.com/${slug}/${id}` : null;
    case 'greenhouse':
      return NUMERIC.test(id) ? `https://job-boards.greenhouse.io/${slug}/jobs/${id}` : null;
    case 'lever':
      return UUID.test(id) ? `https://jobs.lever.co/${slug}/${id}` : null;
  }
}

interface Job {
  id: string;
  title: string;
  location: string;
  posted_at: string;
  remote: boolean | undefined;
  body: string;
}

function validTime(s: string | undefined): s is string {
  return s !== undefined && Number.isFinite(Date.parse(s));
}

// Posted time is the publish time only. `updated_at` resets on any edit and would fake freshness.

function ashbyJobs(json: unknown): Job[] {
  if (!isRecord(json) || !Array.isArray(json.jobs)) throw new SourceError('schema');
  const jobs: Job[] = [];
  for (const j of json.jobs) {
    if (!isRecord(j) || j.isListed === false) continue;
    const id = str(j.id);
    const title = str(j.title);
    const posted = str(j.publishedAt);
    if (!id || !title || !validTime(posted)) continue;
    // workplaceType wins when present: Ashby sets isRemote on hybrid roles too.
    const workplace = str(j.workplaceType);
    const remote = workplace ? workplace === 'Remote' : typeof j.isRemote === 'boolean' ? j.isRemote : undefined;
    jobs.push({ id, title, location: str(j.location) ?? '', posted_at: posted, remote, body: str(j.descriptionPlain) ?? '' });
  }
  return jobs;
}

function greenhouseJobs(json: unknown): Job[] {
  if (!isRecord(json) || !Array.isArray(json.jobs)) throw new SourceError('schema');
  const jobs: Job[] = [];
  for (const j of json.jobs) {
    if (!isRecord(j)) continue;
    const id = typeof j.id === 'number' ? String(j.id) : str(j.id);
    const title = str(j.title);
    const posted = str(j.first_published);
    if (!id || !title || !validTime(posted)) continue;
    const location = isRecord(j.location) ? (str(j.location.name) ?? '') : '';
    // No structured remote field: the text gate reads the location inside the title.
    jobs.push({ id, title, location, posted_at: posted, remote: undefined, body: '' });
  }
  return jobs;
}

function leverJobs(json: unknown): Job[] {
  if (!Array.isArray(json)) throw new SourceError('schema');
  const jobs: Job[] = [];
  for (const j of json) {
    if (!isRecord(j)) continue;
    const id = str(j.id);
    const title = str(j.text);
    if (!id || !title || typeof j.createdAt !== 'number' || !Number.isFinite(j.createdAt)) continue;
    const location = isRecord(j.categories) ? (str(j.categories.location) ?? '') : '';
    const remote = j.workplaceType === 'remote' || /\bremote\b/i.test(location);
    jobs.push({
      id,
      title,
      location,
      posted_at: new Date(j.createdAt).toISOString(),
      remote,
      body: str(j.descriptionPlain) ?? '',
    });
  }
  return jobs;
}

const PARSERS: Record<Platform, (json: unknown) => Job[]> = {
  ashby: ashbyJobs,
  greenhouse: greenhouseJobs,
  lever: leverJobs,
};

/** The ATS says remote but the location only names a place ("New York"): say so, or the row reads as onsite. */
function placeLabel(job: Job): string {
  const location = job.location.trim();
  if (job.remote !== true || /\bremote\b/i.test(location)) return location;
  return location ? `Remote (${location})` : 'Remote';
}

export function parseBoard(board: Board, json: unknown): Candidate[] {
  const posts: Candidate[] = [];
  for (const job of PARSERS[board.platform](json)) {
    const url = jobUrl(board.platform, board.slug, job.id);
    if (!url) continue;
    posts.push({
      id: `boards:${board.platform}:${board.slug}:${job.id}`,
      source: 'boards',
      where: `${board.company} careers`,
      title: [board.company, job.title.trim(), placeLabel(job)].filter(Boolean).join(' | '),
      posted_at: job.posted_at,
      url,
      body: job.body,
      remote: job.remote,
    });
  }
  return posts;
}
