require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { handleWebhook } = require('./webhook');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Email capture file
const SUBSCRIBERS_FILE = path.join(__dirname, '..', 'subscribers.json');

function loadSubscribers() {
  try {
    if (fs.existsSync(SUBSCRIBERS_FILE)) {
      return JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf8'));
    }
  } catch (e) { console.error('Error loading subscribers:', e.message); }
  return [];
}

function saveSubscriber(email, tier = 'free') {
  const subscribers = loadSubscribers();
  const existing = subscribers.find(s => s.email === email);
  if (!existing) {
    subscribers.push({ email, tier, joined: new Date().toISOString() });
    fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(subscribers, null, 2));
    return true;
  }
  return false;
}

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

// Marketing landing page endpoint
app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>AI PR Reviewer - Automated Code Reviews</title>
  <meta name="description" content="AI-powered GitHub PR reviewer using Claude. Get instant code reviews on every pull request.">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; line-height: 1.6; }
    h1 { color: #2563eb; }
    .price { font-size: 2em; color: #059669; font-weight: bold; }
    .features { background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .cta { background: #2563eb; color: white; padding: 15px 30px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block; margin: 20px 0; }
    .cta:hover { background: #1d4ed8; }
    code { background: #e5e7eb; padding: 2px 6px; border-radius: 4px; }
    footer { margin-top: 40px; color: #6b7280; font-size: 0.9em; }
    .subscribe-form { background: #eff6ff; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .subscribe-form input { padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 4px; width: 250px; }
    .subscribe-form button { padding: 10px 20px; font-size: 16px; background: #059669; color: white; border: none; border-radius: 4px; cursor: pointer; }
    .subscribe-form button:hover { background: #047857; }
    #message { margin-top: 10px; padding: 10px; border-radius: 4px; }
    .success { background: #d1fae5; color: #065f46; }
    .error { background: #fee2e2; color: #991b1b; }
  </style>
</head>
<body>
  <h1>🤖 AI PR Reviewer</h1>
  <p>Automated code reviews for your GitHub repositories using Claude AI.</p>
  
  <div class="price">Free: 10 reviews/month • Pro: $29/month (unlimited)</div>
  
  <div class="features">
    <h3>What's Included:</h3>
    <ul>
      <li>✅ Automatic reviews on every PR</li>
      <li>✅ Security vulnerability detection</li>
      <li>✅ Code quality suggestions</li>
      <li>✅ Best practices recommendations</li>
      <li>✅ Multi-language support</li>
    </ul>
  </div>
  
  <div class="subscribe-form">
    <h3>🚀 Get Early Access</h3>
    <p>Join the waitlist to be notified when we launch Pro features:</p>
    <form id="subscribeForm">
      <input type="email" id="email" placeholder="your@email.com" required>
      <button type="submit">Join Waitlist</button>
    </form>
    <div id="message"></div>
  </div>
  
  <h2>Quick Setup</h2>
  <ol>
    <li>Install the GitHub App from marketplace</li>
    <li>Select repositories to enable</li>
    <li>Get AI-powered reviews on every PR!</li>
  </ol>
  
  <h2>Pricing</h2>
  <table>
    <tr><td>Free Tier</td><td><strong>10 reviews/month</strong></td><td>$0</td></tr>
    <tr><td>Pro Tier</td><td><strong>Unlimited reviews</strong></td><td>$29/mo</td></tr>
  </table>
  
  <footer>
    <p>Questions? Contact: support@aiprreviewer.dev</p>
    <p>© 2026 AI PR Reviewer</p>
  </footer>
  
  <script>
    document.getElementById('subscribeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const msg = document.getElementById('message');
      try {
        const res = await fetch('/subscribe', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({email, tier: 'pro'})
        });
        const data = await res.json();
        msg.textContent = data.message;
        msg.className = res.ok ? 'success' : 'error';
      } catch (err) {
        msg.textContent = 'Error subscribing. Please try again.';
        msg.className = 'error';
      }
    });
  </script>
</body>
</html>
  `);
});

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

// Comprehensive status endpoint - shows all system dependencies
app.get('/status', async (req, res) => {
  const status = {
    service: 'ai-pr-reviewer',
    timestamp: new Date().toISOString(),
    uptime: process.uptime ? `${Math.floor(process.uptime())}s` : 'unknown',
    config: {
      hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
      hasGitHubAppId: !!process.env.GITHUB_APP_ID,
      hasPrivateKey: !!process.env.GITHUB_PRIVATE_KEY,
      hasWebhookSecret: !!process.env.GITHUB_WEBHOOK_SECRET,
      securityScanEnabled: process.env.ENABLE_SECURITY_SCAN === 'true',
      model: process.env.AI_MODEL || 'claude-sonnet-4-6',
      freeTierLimit: process.env.FREE_TIER_LIMIT || 10,
    },
    usage: {
      trackedRepositories: usageStore.size,
    },
    ready: !!(process.env.ANTHROPIC_API_KEY && process.env.GITHUB_APP_ID)
  };
  
  // Test Anthropic API connectivity if key is present
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }]
      });
      status.anthropic = { connected: true };
    } catch (e) {
      status.anthropic = { connected: false, error: e.message };
    }
  }
  
  res.json(status);
});

// Subscribe endpoint - captures emails for newsletter/payment
app.post('/subscribe', (req, res) => {
  const { email, tier } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  
  // Basic email validation
  if (!email.includes('@') || !email.includes('.')) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  
  const saved = saveSubscriber(email, tier || 'pro');
  if (saved) {
    console.log(`📧 New subscriber: ${email} (${tier || 'pro'})`);
    res.json({ ok: true, message: 'You\'re on the list! We\'ll notify you when payments are live.' });
  } else {
    res.json({ ok: true, message: 'You\'re already subscribed!' });
  }
});

// Get subscriber count (for analytics)
app.get('/subscribers/count', (req, res) => {
  const subscribers = loadSubscribers();
  res.json({ 
    total: subscribers.length,
    byTier: subscribers.reduce((acc, s) => {
      acc[s.tier] = (acc[s.tier] || 0) + 1;
      return acc;
    }, {})
  });
});

// Purchase inquiry endpoint - logs interest for manual follow-up
const INQUIRIES_FILE = path.join(__dirname, '..', 'inquiries.json');

function loadInquiries() {
  try {
    if (fs.existsSync(INQUIRIES_FILE)) {
      return JSON.parse(fs.readFileSync(INQUIRIES_FILE, 'utf8'));
    }
  } catch (e) { console.error('Error loading inquiries:', e.message); }
  return [];
}

function saveInquiry(inquiry) {
  const inquiries = loadInquiries();
  inquiries.push({ ...inquiry, created: new Date().toISOString() });
  fs.writeFileSync(INQUIRIES_FILE, JSON.stringify(inquiries, null, 2));
  console.log(`💰 New inquiry: ${inquiry.type} - ${inquiry.email}`);
}

app.post('/inquire', (req, res) => {
  const { email, name, company, type, message } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  
  saveInquiry({ email, name, company, type, message });
  res.json({ ok: true, message: 'Thanks for your interest! We\'ll be in touch soon.' });
});

// Get inquiries (for admin)
app.get('/inquiries', (req, res) => {
  const inquiries = loadInquiries();
  res.json({ total: inquiries.length, inquiries });
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

// Global usage stats - aggregate for all repos
app.get('/stats', (req, res) => {
  const repos = {};
  let totalReviews = 0;
  
  for (const [key, count] of usageStore.entries()) {
    const [repo] = key.split(':');
    repos[repo] = (repos[repo] || 0) + count;
    totalReviews += count;
  }
  
  res.json({
    totalReviews,
    trackedRepos: Object.keys(repos).length,
    repos,
    limit: process.env.FREE_TIER_LIMIT || 10
  });
});

app.post('/webhook', handleWebhook);

app.listen(PORT, '0.0.0.0', () => console.log(`🤖 AI PR Reviewer running on port ${PORT}`));
