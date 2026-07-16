'use strict';

const MATCH_AI_RERANK_ENABLED =
  String(process.env.MATCH_AI_RERANK_ENABLED || 'false').toLowerCase() === 'true';

async function rerankCandidates(source, ranked) {
  if (!MATCH_AI_RERANK_ENABLED) {
    return {
      enabled: false,
      ranked
    };
  }

  // Safe no-op placeholder.
  // Later you can replace this with OpenAI or another reranker.
  return {
    enabled: true,
    ranked
  };
}

module.exports = {
  rerankCandidates
};
