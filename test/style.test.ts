import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../public/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tokenBlock = css.match(/:root \{[^}]*\}/)?.[0] ?? '';

/** Each `--name: light-dark(#light, #dark)` token as [light, dark]. */
const colors = Object.fromEntries([...tokenBlock.matchAll(/--([\w-]+):\s*light-dark\((#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\)/gi)].map((m) => [m[1], [m[2], m[3]]])) as Record<
  string,
  [string, string]
>;

// WCAG 2 relative luminance and contrast ratio.
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('style tokens', () => {
  it('keeps every color and length in the token block', () => {
    // A @media condition cannot read var(), and @font-face only names the font file.
    const rest = css
      .replace(tokenBlock, '')
      .replace(/@font-face \{[^}]*\}/, '')
      .replace(/@media \([^)]*\)/g, '@media');
    expect(rest.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|light-dark)\(|(?<![\w-])\d*\.?\d+(?:px|rem|em|ch|vh|vw|%)/gi) ?? []).toEqual([]);
  });

  it.each(['ink', 'ink-2', 'signal', 'alert'])('%s text reads at 4.5:1 or better on paper, both themes', (token) => {
    // ink-2 is also the ink of seen rows, so dimming can never drop below this.
    for (const side of [0, 1]) expect(contrast(colors[token]![side]!, colors.paper![side]!)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps alert text readable on its banner, and the input rule visible', () => {
    for (const side of [0, 1]) {
      expect(contrast(colors.alert![side]!, colors['alert-wash']![side]!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors['rule-strong']![side]!, colors.paper![side]!)).toBeGreaterThanOrEqual(3);
    }
  });
});
