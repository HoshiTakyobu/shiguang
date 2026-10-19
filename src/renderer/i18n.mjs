const en = await window.shiguang.getTranslations();
let language = 'zh-CN';
const bindings = [];
// Capture only the initial, static DOM. Dynamic values are translated by renderers.
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
while (walker.nextNode()) {
  const node = walker.currentNode, original = node.textContent;
  if (en[original.trim()]) bindings.push(() => { node.textContent = original.replace(original.trim(), t(original.trim())); });
}
for (const element of document.querySelectorAll('[title], [aria-label]')) {
  for (const name of ['title', 'aria-label']) {
    const value = element.getAttribute(name);
    if (en[value]) bindings.push(() => element.setAttribute(name, t(value)));
  }
}
export function t(text, values = {}) {
  let result = language === 'en' ? (en[text] || text) : text;
  for (const [key, value] of Object.entries(values)) result = result.replaceAll(`{${key}}`, String(value));
  return result;
}
export function setLanguage(value) {
  if (document.documentElement.lang === value && language === value) return;
  language = value || 'zh-CN';
  document.documentElement.lang = language;
  bindings.forEach(update => update());
}
export function weekdays(short = false) {
  return Array.from({ length: 7 }, (_, day) => new Intl.DateTimeFormat(language, { weekday: short ? 'short' : 'long' }).format(new Date(2023, 0, 1 + day)));
}
