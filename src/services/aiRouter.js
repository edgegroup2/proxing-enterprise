'use strict';

const {
  assertBudgetAvailable,
  logAIUsage
} = require('./aiBudgetGuard');

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';

function estimateCostUsd(provider, inputTokens, outputTokens) {
  if (provider === 'openai') {
    return inputTokens * 0.00000015 + outputTokens * 0.0000006;
  }

  return 0;
}

function cleanJSON(raw) {
  if (!raw) return '{}';

  return raw
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim();
}

async function callChatProvider({
  provider,
  feature,
  messages,
  model,
  maxTokens = 1000,
  temperature = 0.3
}) {
  await assertBudgetAvailable();

  let url;
  let apiKey;

  if (provider === 'groq') {
    url = 'https://api.groq.com/openai/v1/chat/completions';
    apiKey = process.env.GROQ_API_KEY;
    model = model || GROQ_MODEL;
  } else {
    provider = 'openai';
    url = 'https://api.openai.com/v1/chat/completions';
    apiKey = process.env.OPENAI_API_KEY;
    model = model || OPENAI_MODEL;
  }

  if (!apiKey) {
    throw new Error(`${provider.toUpperCase()} API key missing`);
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens
    })
  });

  const text = await response.text();

  if (!response.ok) {
    await logAIUsage({
      feature,
      provider,
      model,
      status: 'failed',
      error: text
    });

    throw new Error(`${provider} error ${response.status}: ${text}`);
  }

  const json = JSON.parse(text);
  const content = json.choices?.[0]?.message?.content || '{}';

  const inputTokens = json.usage?.prompt_tokens || 0;
  const outputTokens = json.usage?.completion_tokens || 0;

  await logAIUsage({
    feature,
    provider,
    model,
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateCostUsd(provider, inputTokens, outputTokens)
  });

  return content;
}

async function aiJSON({
  feature,
  task,
  messages,
  maxTokens = 1000,
  temperature = 0.3
}) {
  const provider =
    task === 'bulk_question_generation'
      ? process.env.AI_PROVIDER_BULK || 'groq'
      : process.env.AI_PROVIDER_DEFAULT || 'openai';

  const raw = await callChatProvider({
    provider,
    feature,
    messages,
    maxTokens,
    temperature
  });

  return JSON.parse(cleanJSON(raw));
}

module.exports = {
  aiJSON,
  callChatProvider
};
