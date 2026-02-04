// src/ai/llmSuggestor.js
// This NEVER executes anything. Only suggestions.

async function suggestIfAmbiguous(intent, rawText) {
  if (intent.service) return null;

  // Example heuristic (later connect OpenAI)
  if (rawText.includes("tv")) {
    return "Did you mean: pay dstv compact 7034567890 ?";
  }

  if (rawText.includes("light")) {
    return "Did you mean: pay electricity ikeja 5000 12345678901 ?";
  }

  return null;
}

module.exports = { suggestIfAmbiguous };
