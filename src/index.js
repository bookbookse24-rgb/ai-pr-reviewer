require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { handleWebhook } = require('./webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// Simple in-memory usage tracking (use Redis for production)
const usageStore = new Map();

function trackUsage(repoFullName) {
  const today = new Date().toISOString().split('T')[0];
  const key = `${repoFullName}:${today}`;
  usageStore.set(key, (usageStore.get(key) || 0) + 1);
  
  // Keep only last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  for (const k of usageStore.keys()) {
    const date = k.split(':')[1];
    if (new Date(date) < thirtyDaysAgo) usageStore.delete(k);
  }
}

function getUsage(repoFullName) {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  
  return {
    today: usageStore.get(`${repoFullName}:${today}`) || 0,
    yesterday: usageStore.get(`${repoFullName}:${yesterday}`) || 0,
    total: Array.from(usageStore.entries())
      .filter(([k]) => k.startsWith(repoFullName))
      .reduce((sum, [, v]) => sum + v, 0)
  };
}

// Make tracking functions available to webhook
module.exports = { trackUsage, getUsage };

app.use(bodyParser.json());

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'ai-pr-reviewer' }));

app.get('/setup', (req, res) => {
  const checks = {
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    GITHUB_APP_ID: !!process.env.GITHUB_APP_ID,
    GITHUB_PRIVATE_KEY: !!process.env.GITHUB_PRIVATE_KEY,
    GITHUB_WEBHOOK_SECRET: !!process.env.GITHUB_WEBHOOK_SECRET,
  };
  const allPassed = Object.values(checks).every(v => v);
  res.json({ status: allPassed ? 'ready' : 'not_ready', checks });
});

// Usage stats endpoint - useful for Pro tier limiting
app.get('/stats/:owner/:repo', (req, res) => {
  const { owner, repo } = req.params;
  const repoFullName = `${owner}/${repo}`;
  const usage = getUsage(repoFullName);
  const limit = process.env.FREE_TIER_LIMIT || 10;
  const remaining = Math.max(0, limit - usage.today);
  
  res.json({
    repo: repoFullName,
    usage,
    limit,
    remaining,
    tier: remaining > 0 ? 'free' : 'pro_required'
  });
});

app.post('/webhook', handleWebhook);

app.listen(PORT, '0.0.0.0', () => console.log(`🤖 AI PR Reviewer running on port ${PORT}`));
