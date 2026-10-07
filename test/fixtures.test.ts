import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SEPARATOR, isPostingShape } from '../src/select.ts';
import { decodeEntities, firstLine, htmlToText } from '../src/text.ts';
import { META } from './helpers.ts';

// Fixtures are public. These fail on anything scripts/anonymize.mjs let through.

const DIR = new URL('./fixtures/', import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const text = (f: string) => decodeEntities(readFileSync(new URL(f, DIR), 'utf8'));
const ATS = ['jobs.ashbyhq.com', 'job-boards.greenhouse.io', 'jobs.lever.co'];

describe.each(files)('fixture %s', (file) => {
  it('links only to example.com or aliased ATS boards', () => {
    for (const url of text(file).match(/https?:\/\/[^\s"'<>\\)|]+/g) ?? []) {
      const { host, pathname } = new URL(url);
      if (host === 'example.com') continue;
      expect(ATS, url).toContain(host);
      expect(pathname.split('/')[1], url).toMatch(/^company\d+$/);
    }
  });

  it('holds no email addresses, plain or spelled out', () => {
    expect(text(file)).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(text(file)).not.toMatch(/\w+\s*(?:\[at\]|\(at\))\s*\w+/i);
    expect(text(file)).not.toMatch(/\b\w+ at \w+ dot \w+/i);
  });

  it('carries no author or username fields', () => {
    expect(text(file)).not.toMatch(/"(author|_tags|username)"/);
  });
});

describe('aliases', () => {
  it('meta boards use alias slugs and companies', () => {
    for (const b of META.boards) {
      expect(b.slug).toMatch(/^company\d+$/);
      expect(b.company).toMatch(/^Company\d+$/);
    }
  });

  it('every HN posting names an aliased company', () => {
    const { hits } = JSON.parse(readFileSync(new URL('hn-comments.json', DIR), 'utf8')) as { hits: { comment_text: string }[] };
    for (const hit of hits) {
      const line = firstLine(htmlToText(hit.comment_text));
      if (isPostingShape(line)) expect(line.split(SEPARATOR)[0]?.trim()).toMatch(/^Company\d+$/);
    }
  });
});
