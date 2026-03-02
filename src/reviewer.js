const Anthropic = require('@anthropic-ai/sdk');
const { REVIEW_PROMPT } = require('./prompts');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Configurable model - defaults to sonnet for better quality
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MODEL = process.env.AI_MODEL || DEFAULT_MODEL;

async function reviewCode(diff) {
  if (!diff || diff.trim().length === 0) return null;

  // Support longer diffs with sonnet (higher context window)
  const maxChars = MODEL.includes('sonnet') ? 15000 : 10000;
  const truncated = diff.length > maxChars 
    ? diff.slice(0, maxChars) + `\n\n[Diff truncated at ${maxChars} chars. Using ${MODEL}]` 
    : diff;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: REVIEW_PROMPT(truncated) }],
  });

  return message.content[0].text;
}

module.exports = { reviewCode, MODEL };
