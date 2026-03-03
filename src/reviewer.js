const Anthropic = require('@anthropic-ai/sdk');
const { REVIEW_PROMPT, SECURITY_SCAN_PROMPT } = require('./prompts');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Configurable model - defaults to sonnet for better quality
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MODEL = process.env.AI_MODEL || DEFAULT_MODEL;

// Extract statistics from diff
function extractDiffStats(diff) {
  if (!diff) return {};
  
  const filesChanged = (diff.match(/^diff --git/gm) || []).length;
  const linesAdded = (diff.match(/^\+/gm) || []).length - filesChanged;
  const linesRemoved = (diff.match(/^-/gm) || []).length - filesChanged;
  
  // Simple language detection
  const languages = new Set();
  if (diff.includes('.js') || diff.includes('javascript')) languages.add('JavaScript');
  if (diff.includes('.ts') || diff.includes('.tsx')) languages.add('TypeScript');
  if (diff.includes('.py') || diff.includes('python')) languages.add('Python');
  if (diff.includes('.go')) languages.add('Go');
  if (diff.includes('.rs')) languages.add('Rust');
  if (diff.includes('.java')) languages.add('Java');
  if (diff.includes('.rb') || diff.includes('ruby')) languages.add('Ruby');
  if (diff.includes('.php')) languages.add('PHP');
  if (diff.includes('.sql')) languages.add('SQL');
  if (diff.includes('.sh') || diff.includes('bash')) languages.add('Shell');
  
  return {
    filesChanged,
    linesAdded,
    linesRemoved,
    languages: languages.size > 0 ? Array.from(languages).join(', ') : 'Mixed'
  };
}

async function reviewCode(diff, options = {}) {
  if (!diff || diff.trim().length === 0) return null;

  const stats = extractDiffStats(diff);
  
  // Support longer diffs with sonnet (higher context window)
  const maxChars = MODEL.includes('sonnet') ? 15000 : 10000;
  const truncated = diff.length > maxChars 
    ? diff.slice(0, maxChars) + `\n\n[Diff truncated at ${maxChars} chars. Using ${MODEL}]` 
    : diff;

  // Run security scan separately if enabled (Pro feature)
  let securityFindings = '';
  if (options.securityScan) {
    try {
      const securityMsg = await client.messages.create({
        model: MODEL,
        max_tokens: 512,
        messages: [{ role: 'user', content: SECURITY_SCAN_PROMPT(truncated) }],
      });
      securityFindings = securityMsg.content[0].text;
    } catch (e) {
      console.log('Security scan skipped:', e.message);
    }
  }

  // Main review
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: REVIEW_PROMPT(truncated, stats) }],
  });

  // Combine security findings with main review
  let fullReview = message.content[0].text;
  if (securityFindings && !securityFindings.includes('no vulnerabilities detected')) {
    fullReview = `## 🔒 Security Scan Results\n\n${securityFindings}\n\n---\n\n${fullReview}`;
  }

  return fullReview;
}

module.exports = { reviewCode, MODEL, extractDiffStats };
