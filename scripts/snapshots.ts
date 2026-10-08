#!/usr/bin/env node
// The scheduled job's build step: the boards snapshot and the hn baseline, from live sources.
// Manual or scheduled only: CI never calls live sources.
//
//   node scripts/snapshots.ts <out-dir>
//
// Writes <out-dir>/boards.json and <out-dir>/hn.json, each only when good enough to replace the
// one in KV, and exits 1 if either was withheld. Uploading is a separate step that holds the token.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { USER_AGENT } from '../src/app.ts';
import { runJob } from '../src/job.ts';

const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/snapshots.ts <out-dir>');
  process.exit(2);
}

async function save(name: string, data: unknown): Promise<string> {
  const text = JSON.stringify(data);
  await writeFile(join(out!, name), text);
  return `${(text.length / 1024).toFixed(1)} KB -> ${join(out!, name)}`;
}

const started = performance.now();
const run = await runJob({ fetch, now: new Date(), userAgent: USER_AGENT });
await mkdir(out, { recursive: true });

const { snapshot, failures, writable } = run.boards;
const boardsLine = `boards  ok ${snapshot.boards_ok}/${snapshot.boards_total}  items ${snapshot.items.length}`;
console.log(writable ? `${boardsLine}  ${await save('boards.json', snapshot)}` : `${boardsLine}  WITHHELD: under half the boards answered`);
for (const { board, error } of failures) console.log(`  failed ${board.platform}:${board.slug} ${error}`);
for (const { thread_id, error } of run.skipped) console.log(`  discovery skipped thread ${thread_id} ${error}`);

const hnLine = `hn      thread ${run.thread.id}  postings ${run.postings}`;
console.log(
  run.baseline
    ? `${hnLine}  items ${run.baseline.items.length}  watermark ${run.baseline.watermark}  ${await save('hn.json', run.baseline)}`
    : `${hnLine}  WITHHELD: Algolia truncated the thread`,
);

console.log(`run ${((performance.now() - started) / 1000).toFixed(1)}s`);
if (!writable || !run.baseline) process.exit(1);
