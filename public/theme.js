// @ts-check
// Classic script in <head>, before the stylesheet, so the first paint is already in the chosen theme.
// Key and values match loadTheme in lib.js; test/lib.test.ts runs this file against both.
try {
  const choice = localStorage.getItem('firsthour:theme');
  if (choice === 'light' || choice === 'dark') document.documentElement.dataset.theme = choice;
} catch {
  // Storage blocked: the system theme applies.
}
