#!/usr/bin/env node
// Live source check. Manual only: CI never calls live sources.
//
//   node scripts/probe.mjs fixtures      record sanitized fixtures into test/fixtures/
//   node scripts/probe.mjs <base-url>    check /api/posts on a running Worker
//
// Fixtures are committed to a public repo, so everything recorded goes through anonymize.mjs:
// real shapes, synthetic content. test/fixtures.test.ts fails on anything that slips through.

import { mkdir, writeFile } from 'node:fs/promises';
import { apiUrl } from '../src/boards/ats.ts';
import { discover } from '../src/boards/discover.ts';
import { commentsUrl, pickThreads, THREADS_URL, topLevelComments } from '../src/sources/hn.ts';
import { JOBS_URL } from '../src/sources/yc.ts';
import { createAnonymizer } from './anonymize.mjs';

const UA = 'firsthour-probe (+https://github.com/1mb-dev/firsthour)';
const OUT = new URL('../test/fixtures/', import.meta.url);

async function getJson(url) {
  const response = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));

async function save(name, data) {
  await writeFile(new URL(name, OUT), JSON.stringify(data, null, 2) + '\n');
  console.log(`  wrote test/fixtures/${name}`);
}

async function recordFixtures() {
  await mkdir(OUT, { recursive: true });
  const recordedAt = new Date().toISOString();
  const anon = createAnonymizer();

  const threadsJson = await getJson(THREADS_URL);
  await save('hn-threads.json', { hits: threadsJson.hits.map((h) => pick(h, ['objectID', 'title', 'created_at'])) });
  const thread = pickThreads(threadsJson)[0];
  if (!thread) throw new Error('no Who is hiring thread found');

  const commentsJson = await getJson(commentsUrl(thread.id, 1000));
  const top = topLevelComments(commentsJson, thread.id);
  // Up to 8 postings linking each platform, then the newest others, to 40.
  const keep = new Set();
  for (const host of ['ashbyhq', 'greenhouse', 'lever.co']) {
    for (const c of top.filter((c) => c.html.includes(host)).slice(0, 8)) keep.add(c.id);
  }
  for (const c of top) if (keep.size < 40) keep.add(c.id);
  const replies = commentsJson.hits.filter((h) => String(h.parent_id) !== thread.id).slice(0, 3);
  await save('hn-comments.json', {
    hits: [
      ...commentsJson.hits
        .filter((h) => keep.has(h.objectID))
        .map((h) => ({ ...pick(h, ['objectID', 'parent_id', 'created_at']), comment_text: anon.comment(h.comment_text ?? '') })),
      ...replies.map((h) => ({ ...pick(h, ['objectID', 'parent_id', 'created_at']), comment_text: 'Reply text removed.' })),
    ],
  });

  const jobsJson = await getJson(JOBS_URL);
  await save('yc-jobs.json', {
    hits: jobsJson.hits.map((h) => ({ ...pick(h, ['objectID', 'created_at']), title: anon.ycTitle(h.title ?? ''), ...(h.story_text ? { story_text: '' } : {}) })),
  });

  // One board per platform: the first that answers with jobs.
  const boards = discover(topLevelComments(commentsJson, thread.id));
  const chosen = [];
  for (const platform of ['ashby', 'greenhouse', 'lever']) {
    for (const board of boards.filter((b) => b.platform === platform)) {
      const json = await getJson(apiUrl(board)).catch(() => null);
      const jobs = Array.isArray(json) ? json : json?.jobs;
      if (!jobs?.length) continue;
      const trimmed = jobs.slice(0, 8).map((j) =>
        pick(j, ['id', 'title', 'text', 'location', 'categories', 'publishedAt', 'first_published', 'createdAt', 'isListed', 'isRemote', 'workplaceType', 'descriptionPlain']),
      );
      const safe = anon.boardJobs(trimmed, board);
      await save(`${platform}.json`, Array.isArray(json) ? safe : { jobs: safe });
      chosen.push(anon.board(board));
      break;
    }
  }
  await save('meta.json', { recorded_at: recordedAt, thread, boards: chosen });
}

async function checkWorker(base) {
  const response = await fetch(new URL('/api/posts', base), { headers: { 'user-agent': UA } });
  const body = await response.json();
  console.log(`HTTP ${response.status}  stale=${body.stale}  items=${body.items?.length}  next_thread=${body.next_thread}`);
  for (const s of body.sources ?? []) console.log(`  ${s.id.padEnd(7)} ok=${s.ok} count=${s.count} error=${s.error} fetched_at=${s.fetched_at}`);
  if (!response.ok || !body.sources?.every((s) => s.ok)) process.exit(1);
}

const arg = process.argv[2];
if (arg === 'fixtures') await recordFixtures();
else if (arg?.startsWith('http')) await checkWorker(arg);
else {
  console.error('usage: node scripts/probe.mjs fixtures | <base-url>');
  process.exit(2);
}
