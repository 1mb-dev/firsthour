# Design

firsthour is a logbook. Roles are entries stamped by age, and the page exists to show what arrived since you last looked. Time leads every row, unread entries carry full ink, and nothing a reader needs to decide is ever cut off.

All values live in one token block at the top of `public/style.css`. `test/style.test.ts` fails on any color or length outside it.

## Type

One family: [Recursive](https://github.com/arrowtype/recursive), self-hosted at `public/fonts/recursive.woff2` (latin, `wght` + `MONO` axes, 73 KB, OFL in `recursive-OFL.txt`). No font is loaded from another origin.

| Token | Use |
|---|---|
| `--axes-text` (`MONO` 0) | company, role, body |
| `--axes-mono` (`MONO` 1) | age, source, status, counts, brand, group headers |
| `--size-body` 15 px | rows; the floor for text a reader acts on |
| `--size-meta` 13 px | status, source, footer |
| `--weight-strong` 640 | company, new age, group headers |

`CASL` stays 0: the face reads linear, not casual.

The CSP needs `font-src 'self'`. Without it, `default-src 'none'` blocks the font, and the only report is a console message. `scripts/probe.mjs` checks the header and the font URL on a live Worker.

## Color

Each color is written once as `light-dark(light, dark)`. The system theme picks a side; `data-theme` on `<html>` pins it.

| Token | Light | Dark | Role | Contrast on paper (light / dark) |
|---|---|---|---|---|
| `--paper` | `#e1edf0` | `#051a1d` | page | |
| `--ink` | `#14202b` | `#cde3e0` | text, rows not read yet | 13.8 / 13.4 |
| `--ink-2` | `#45545e` | `#8fabab` | read rows, meta | 6.6 / 7.3 |
| `--signal` | `#0a6b4c` | `#5fd3a5` | new rows, First hour, focus | 5.5 / 9.7 |
| `--alert` | `#a3261b` | `#ff8f80` | failed sources, stale banner | 6.2 / 8.1 |
| `--rule-strong` | = ink | = ink | masthead, group rules, input | |
| `--rule` | `#c3d5d9` | `#17393c` | row dividers (decorative) | |

Every text token reads at 4.5:1 or better on paper in both themes, and the test pins it. Read rows use `--ink-2`, so dimming never drops below that floor.

The palette is cool on purpose. The sibling sift is a warm cream reading desk, so no firsthour token sits within ΔE 5 (CIE76) of a sift token.

## Rows

```
desktop   age │ company │ role, then who may apply                    │ source
mobile    age │ company                                               │ source
                role, whole
```

- **Age** leads: `12m`, `3h`, `2d`, mono with tabular figures.
- **Company and role** come from the title's `Company | Role | …` convention (`parts` in `public/lib.js`). URLs are dropped from display, since the link is built from a validated id. HN job stories have no company part.
- **Source** is one quiet word: `HN`, `HN jobs`, `board`.
- **Nothing is truncated.** In HN titles the restriction ("US only", "visa possible") usually comes last, so rows wrap instead of cutting. Titles are capped at 160 characters upstream.

## New and read

Two signals, two facts:

| Row | Means |
|---|---|
| signal tick, signal age | **new**: arrived since your last visit (it was not listed then) |
| full ink | not read yet: never on screen in an earlier visit |
| `--ink-2` | read |

- A row is read once most of it has been on screen (IntersectionObserver, 60 %). Rows you never scrolled to keep full ink, though they lose the tick once they have been listed.
- The count line opens with the same tick, as the key: "12 new since Thu, Oct 8, 11:45 AM". It counts arrivals only.
- A first visit has no baseline: no ticks, nothing dimmed.
- A record from before reading was tracked loads as all read.
- Screen readers get the word "new", which is visually hidden.
- **First hour** is the only group header in signal color. It is the event the page is named for, and its one raised voice.

## Theme

`auto` / `light` / `dark` sits in the masthead. `public/theme.js` is a classic script placed before the stylesheet, so the first paint uses the stored choice. Storage failure means auto.

`light-dark()` has been Baseline since May 2024. In an older browser the color tokens are invalid, and the page falls back to default black on the canvas: readable, without the palette.

## Rules

- Tokens only: a new value is a new token.
- Text is never cut. If a row needs more room, it wraps.
- Calm: a finite list with an end. No badges, no counters beyond the new count and the filter's "N of M", no animation.
- Untrusted text is rendered with `textContent` only.

What this design avoids:
- cream paper;
- small uppercase tracked labels;
- a grey meta line above every title;
- an amber accent;
- the system font stack;
- rounded cards;
- palette values copied from a framework.
