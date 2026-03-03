require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { handleWebhook } = require('./webhook');

const app = express();
const PORT = process.env.PORT || 3000;

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

app.post('/webhook', handleWebhook);

app.listen(PORT, '0.0.0.0', () => console.log(`🤖 AI PR Reviewer running on port ${PORT}`));
