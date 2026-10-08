// Turns recorded responses into public-safe fixtures: the JSON shape, field set and Algolia's HTML
// encoding stay real; companies, slugs, links, ids and prose become synthetic. Aliases are stable
// within one recording, so a board in meta.json matches the link in the posting that names it.

import { extractBoards } from '../src/boards/discover.ts';
import { isPostingShape, SEPARATOR } from '../src/select.ts';
import { firstLine, htmlToText } from '../src/text.ts';

/** HN item ids from here are synthetic; real ones passed 1,000,000 in 2010. Thread ids stay real. */
export const SYNTHETIC_ID_LIMIT = 1_000_000;
export const ATS_HOSTS = { ashby: 'jobs.ashbyhq.com', greenhouse: 'job-boards.greenhouse.io', lever: 'jobs.lever.co' };
const FILLER = 'Details of the role, the team and how to apply are in the original post.';
const APPLICANT = "I'm applying for the backend role above; my details are in my profile.";
const EMAIL = /[\w.+-]+\s*(?:@|\[at\]|\(at\)|\bat\b)\s*[\w-]+(?:\s*(?:\.|\[dot\]|\(dot\)|\bdot\b)\s*[\w-]+)+/gi;
const URL_RE = /\bhttps?:\/\/[^\s|)\]>"']+/gi;
const DOMAIN = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|ai|dev|app|co|org|net|xyz|so|tech|health|us|eu|uk|de|fr)\b(?:\/[^\s|)\]]*)?/gi;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Algolia's comment_text encoding, which the parsers must keep handling. */
function encode(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

export function createAnonymizer() {
  const companies = new Map();
  const slugs = new Map();
  const items = new Map();
  let jobCount = 0;

  /** Comment and story ids: a real one resolves to the original post, naming its company. */
  function itemId(id) {
    const key = String(id);
    if (!items.has(key)) items.set(key, String(100_001 + items.size));
    return items.get(key);
  }

  function companyAlias(name) {
    const key = name.toLowerCase();
    if (!companies.has(key)) companies.set(key, `Company${companies.size + 1}`);
    return companies.get(key);
  }

  function slugAlias(platform, slug) {
    const key = `${platform}:${slug}`;
    if (!slugs.has(key)) slugs.set(key, `company${slugs.size + 1}`);
    return slugs.get(key);
  }

  /** The name as written plus its core: "Initech (YC S23, https://…)" and "Globex.com" also yield "Initech", "Globex". */
  function variants(name) {
    const core = name.replace(/\s*\(.*$/, '').replace(/\.[a-z]+$/i, '').trim();
    return [...new Set([name, core].filter((n) => n.length > 1))].sort((a, b) => b.length - a.length);
  }

  function scrub(text, names, alias) {
    let out = text.replace(EMAIL, '[email]');
    for (const n of names) out = out.replace(new RegExp(escapeRe(n), 'gi'), alias);
    return out.replace(URL_RE, 'https://example.com').replace(DOMAIN, (d) => (d.startsWith('example.com') ? d : 'example.com'));
  }

  function link(platform, slug) {
    const url = `https://${ATS_HOSTS[platform]}/${slug}`;
    return `<a href="${encode(url)}" rel="nofollow">${encode(url)}</a>`;
  }

  /** A posting keeps its header shape with the company aliased; its body becomes filler plus its board links. */
  function comment(html) {
    const header = firstLine(htmlToText(html));
    if (!isPostingShape(header)) return encode(APPLICANT);
    const name = header.split(SEPARATOR)[0].trim();
    const alias = companyAlias(name);
    const rest = header.slice(header.indexOf(name) + name.length);
    const boards = extractBoards(html).map((b) => `<p>Apply: ${link(b.platform, slugAlias(b.platform, b.slug))}`);
    return `${encode(alias + scrub(rest, variants(name), alias))}<p>${encode(FILLER)}${[...new Set(boards)].join('')}`;
  }

  function ycTitle(title) {
    const match = /^(.*?)\s+(?:\(YC [^)]*\)|is hiring)/i.exec(title);
    if (!match) return `${companyAlias(title)} Is Hiring${/remote/i.test(title) ? ' (Remote)' : ''}`;
    const alias = companyAlias(match[1]);
    return alias + scrub(title.slice(match[1].length), variants(match[1]), alias);
  }

  function board(b) {
    return { platform: b.platform, slug: slugAlias(b.platform, b.slug), company: companyAlias(b.company) };
  }

  /** Board jobs: synthetic ids and descriptions, company names scrubbed from every string field. */
  function boardJobs(jobs, b) {
    const names = [...variants(b.company), b.slug];
    const alias = companyAlias(b.company);
    const deep = (v) =>
      typeof v === 'string'
        ? scrub(v, names, alias)
        : Array.isArray(v)
          ? v.map(deep)
          : v && typeof v === 'object'
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)]))
            : v;
    return jobs.map((job) => {
      jobCount += 1;
      const id =
        b.platform === 'greenhouse' ? 1000 + jobCount : `00000000-0000-4000-8000-${String(jobCount).padStart(12, '0')}`;
      const out = { ...deep(job), id };
      if ('descriptionPlain' in out) out.descriptionPlain = FILLER;
      return out;
    });
  }

  return { comment, ycTitle, board, boardJobs, itemId };
}
