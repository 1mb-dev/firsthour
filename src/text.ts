const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const hex = entity[1] === 'x' || entity[1] === 'X';
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED[entity.toLowerCase()] ?? match;
  });
}

/**
 * Algolia HTML to plain text, one paragraph per line. The first paragraph arrives unwrapped and
 * later ones open with <p>. Tags are stripped before entities are decoded, so an encoded `&lt;b&gt;`
 * stays visible text instead of becoming markup.
 */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(stripped)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function firstLine(text: string): string {
  const end = text.indexOf('\n');
  return end === -1 ? text : text.slice(0, end);
}

/** Truncates by code point so an emoji is never split into a lone surrogate. */
export function truncate(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max - 1).join('').trimEnd() + '…';
}
