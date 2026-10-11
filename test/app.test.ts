import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// app.js drives the DOM at import, so it is pinned by source rather than run.
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const row = source.match(/^function row\([\s\S]*?^\}/m)?.[0] ?? '';

describe('row link', () => {
  it('opens the posting in a new tab without handing it the page', () => {
    expect(row).not.toBe('');
    expect(row).toContain("target: '_blank'");
    expect(row).toContain("rel: 'noopener'");
  });
});
