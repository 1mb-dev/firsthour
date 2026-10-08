#!/usr/bin/env node
// Asserts the Worker deployment serving traffic is this commit, at 100%.
//
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... COMMIT_SHA=... node scripts/verify-deploy.ts
//
// wrangler exiting 0 is not evidence of a deploy; this reads what Cloudflare reports. It does not
// fetch the public URL: zone-wide bot management on 1mb.dev challenges CI runner IPs.

import { readFile } from 'node:fs/promises';
import { deploymentMismatch, listDeployments, workerName } from '../src/cloudflare.ts';

const ATTEMPTS = 6;
const INTERVAL_MS = 5_000;

const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const sha = process.env.COMMIT_SHA;
if (!token || !account || !sha) {
  console.error('usage: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... COMMIT_SHA=... node scripts/verify-deploy.ts');
  process.exit(2);
}

const script = workerName(await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const ctx = { fetch, token, account };
for (let attempt = 1; ; attempt++) {
  // An API error right after a deploy is retried like a mismatch, not taken as a verdict.
  const mismatch = await listDeployments(ctx, script).then(
    (body) => deploymentMismatch(body, sha),
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
  if (mismatch === null) {
    console.log(`${script}: ${sha} serves 100% of traffic`);
    break;
  }
  if (attempt >= ATTEMPTS) {
    console.error(`${script}: ${mismatch}. Check the Workers deployments in the dashboard; roll back with \`npx wrangler rollback\` if a bad version is live.`);
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
}
