import { describe, expect, it } from 'vitest';
import { decodeEntities, firstLine, htmlToText, truncate } from '../src/text.ts';

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#x27;e&#x27; &#47;f &#x2F;g')).toBe(`a & b <c> "d" 'e' /f /g`);
  });

  it('leaves unknown and out-of-range entities alone', () => {
    expect(decodeEntities('&bogus; &#0; &#x110000;')).toBe('&bogus; &#0; &#x110000;');
  });
});

describe('htmlToText', () => {
  it('turns Algolia paragraphs into lines and drops tags', () => {
    const html = 'Acme | Backend | REMOTE<p>We build <a href="https:&#x2F;&#x2F;acme.dev">things</a>.<p>Apply: jobs';
    expect(htmlToText(html)).toBe('Acme | Backend | REMOTE\nWe build things.\nApply: jobs');
  });

  it('keeps encoded markup as visible text instead of decoding it into tags', () => {
    expect(htmlToText('&lt;script&gt;alert(1)&lt;&#x2F;script&gt;')).toBe('<script>alert(1)</script>');
  });

  it('collapses whitespace and drops empty lines', () => {
    expect(htmlToText('  a   b <p><p>  c ')).toBe('a b\nc');
  });

  it('returns empty for empty input', () => {
    expect(htmlToText('')).toBe('');
  });
});

describe('firstLine', () => {
  it('returns the text up to the first newline, or all of it', () => {
    expect(firstLine('one\ntwo')).toBe('one');
    expect(firstLine('only')).toBe('only');
  });
});

describe('truncate', () => {
  it('leaves short strings alone', () => {
    expect(truncate('short', 10)).toBe('short');
  });

  it('cuts to the limit including the ellipsis', () => {
    const out = truncate('a'.repeat(200), 160);
    expect(Array.from(out)).toHaveLength(160);
    expect(out.endsWith('…')).toBe(true);
  });

  it('never splits an emoji into a lone surrogate', () => {
    const out = truncate('🚀'.repeat(10), 5);
    expect(out).toBe('🚀🚀🚀🚀…');
  });
});
