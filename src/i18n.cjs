const en = require('./locales/en.json');
function translate(text, language = 'zh-CN', values = {}) {
  let result = language === 'en' ? (en[text] || text) : text;
  for (const [key, value] of Object.entries(values)) result = result.replaceAll(`{${key}}`, String(value));
  return result;
}
function translateError(text, language = 'zh-CN') {
  if (language !== 'en') return text;
  let result = text;
  for (const [original, translated] of Object.entries(en).sort((a, b) => b[0].length - a[0].length)) {
    if (original.length > 8) result = result.replaceAll(original, translated);
  }
  return result;
}
module.exports = { translate, translateError };
