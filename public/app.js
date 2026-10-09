// @ts-check
import { age, allDown, group, isActive, isNew, isRead, loadSeen, loadTheme, matches, nextSeen, parseFilter, parts, saveSeen, saveTheme, sourceLabel, statusText } from './lib.js';

/** @typedef {import('./lib.js').Posts} Posts */

const list = /** @type {HTMLElement} */ (document.getElementById('list'));
const status = /** @type {HTMLElement} */ (document.getElementById('status'));
const notice = /** @type {HTMLElement} */ (document.getElementById('notice'));
const count = /** @type {HTMLElement} */ (document.getElementById('count'));
const input = /** @type {HTMLInputElement} */ (document.getElementById('q'));

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const time = (/** @type {string} */ iso) => timeFmt.format(new Date(iso));

function storage() {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

const seen = loadSeen(storage());
/** @type {Posts | null} */
let posts = null;
/** @type {string[]} */
let shown = [];
/** Ids whose row was on screen during this visit. @type {Set<string>} */
const viewed = new Set();
const onScreen = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const id = entry.target instanceof HTMLElement ? entry.target.dataset.id : undefined;
      if (!entry.isIntersecting || !id) continue;
      viewed.add(id);
      onScreen.unobserve(entry.target);
    }
  },
  { threshold: 0.6 },
);

/**
 * @param {string} tag
 * @param {{ class?: string, text?: string, href?: string }} [props]
 * @param {(Node | null)[]} [children]
 */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.href !== undefined && node instanceof HTMLAnchorElement) node.href = props.href;
  for (const child of children) if (child) node.append(child);
  return node;
}

function retryButton() {
  const button = el('button', { class: 'retry', text: 'Retry' });
  button.addEventListener('click', () => void load());
  return button;
}

/** @param {Posts} p */
function renderStatus(p) {
  status.replaceChildren(
    el('span', { text: `Updated ${time(p.generated)}` }),
    ...p.sources.map((s) => el('span', { class: s.ok ? '' : 'warn', text: statusText(s, time) })),
  );
  notice.replaceChildren(
    ...(p.stale ? [el('p', { class: 'banner', text: `Sources are unavailable. Showing the last good copy from ${time(p.generated)}.` })] : []),
  );
}

function render() {
  if (!posts) return;
  const now = Date.now();
  const filter = parseFilter(input.value);
  const visible = posts.items.filter((item) => matches(item, filter));
  shown = visible.map((item) => item.id);
  renderStatus(posts);

  const fresh = visible.filter((item) => isNew(item, seen)).length;
  count.replaceChildren(
    ...(isActive(filter) ? [el('span', { text: `${visible.length} of ${posts.items.length}` })] : []),
    ...(seen && fresh > 0 ? [el('span', { class: 'new-count', text: `${fresh} new since ${dateTimeFmt.format(new Date(seen.at))}` })] : []),
  );

  if (allDown(posts)) {
    list.replaceChildren(el('p', { class: 'empty', text: 'Every source is unavailable right now.' }), retryButton());
    return;
  }
  if (posts.items.length === 0) {
    list.replaceChildren(el('p', { class: 'empty', text: 'Nothing new in the last 7 days.' }), nextThreadLine(posts));
    return;
  }
  if (visible.length === 0) {
    const clear = el('button', { class: 'retry', text: 'Clear filter' });
    clear.addEventListener('click', () => {
      input.value = '';
      onFilter();
    });
    list.replaceChildren(el('p', { class: 'empty', text: 'No matches.' }), clear);
    return;
  }

  const groups = group(visible, now);
  list.replaceChildren(
    ...(groups[0]?.label === 'First hour' ? [] : [nextThreadLine(posts)]),
    ...groups.map((g) =>
      el('section', { class: g.label === 'First hour' ? 'first' : '' }, [
        el('h2', { text: g.label }),
        el(
          'ol',
          {},
          g.items.map((item) => el('li', {}, [row(item, now)])),
        ),
      ]),
    ),
  );
  onScreen.disconnect();
  for (const node of list.querySelectorAll('.row')) onScreen.observe(node);
}

/** @param {import('./lib.js').Item} item @param {number} now */
function row(item, now) {
  const fresh = isNew(item, seen);
  const { company, role } = parts(item);
  const a = el('a', { class: ['row', fresh ? 'new' : '', isRead(item, seen) ? 'read' : ''].filter(Boolean).join(' '), href: item.url }, [
    el('span', { class: 'age' }, [el('span', { text: age(item.posted_at, now) }), fresh ? el('span', { class: 'mark', text: 'new' }) : null]),
    el('span', { class: 'co', text: company }),
    el('span', { class: 'role', text: role }),
    el('span', { class: 'src', text: sourceLabel(item) }),
  ]);
  a.dataset.id = item.id;
  return a;
}

/** @param {Posts} p */
function nextThreadLine(p) {
  return el('p', { class: 'next', text: `Next Who is hiring thread expected ${dateTimeFmt.format(new Date(p.next_thread))}.` });
}

async function load() {
  list.setAttribute('aria-busy', 'true');
  list.replaceChildren(el('p', { class: 'muted', text: 'Loading…' }));
  try {
    const response = await fetch('/api/posts', { headers: { accept: 'application/json' } });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error(`HTTP ${response.status}`);
    posts = /** @type {Posts} */ (await response.json());
    render();
  } catch (error) {
    console.error('firsthour: /api/posts failed', error);
    posts = null;
    status.replaceChildren();
    notice.replaceChildren();
    count.textContent = '';
    list.replaceChildren(el('p', { class: 'empty', text: 'Could not reach firsthour.' }), retryButton());
  } finally {
    list.removeAttribute('aria-busy');
  }
}

function onFilter() {
  const url = new URL(location.href);
  if (input.value.trim()) url.searchParams.set('q', input.value);
  else url.searchParams.delete('q');
  history.replaceState(null, '', url);
  render();
}

function markSeen() {
  if (posts) saveSeen(storage(), nextSeen(seen, posts.items.map((item) => item.id), shown, viewed), new Date());
}

const themeButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-theme-choice]'));

/** @param {import('./lib.js').Theme} theme */
function applyTheme(theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  for (const button of themeButtons) button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme));
}

for (const button of themeButtons) {
  button.addEventListener('click', () => {
    const theme = button.dataset.themeChoice;
    if (theme !== 'auto' && theme !== 'light' && theme !== 'dark') return;
    saveTheme(storage(), theme);
    applyTheme(theme);
  });
}
applyTheme(loadTheme(storage()));

input.value = new URL(location.href).searchParams.get('q') ?? '';
input.addEventListener('input', onFilter);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') markSeen();
});
window.addEventListener('pagehide', markSeen);
void load();
