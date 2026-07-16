const crypto = require('crypto');

function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function questionFingerprint({ question_text, options = [], subject_id, topic_id }) {
  const normalizedQuestion = normalizeText(question_text);
  const normalizedOptions = Array.isArray(options)
    ? options.map(normalizeText).sort().join('|')
    : '';

  const raw = [
    subject_id || '',
    topic_id || '',
    normalizedQuestion,
    normalizedOptions
  ].join('::');

  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = {
  normalizeText,
  questionFingerprint
};
