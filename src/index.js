require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const { handleWebhook } = require('./webhook');
const { quickSecurityScan, extractDiffStats } = require('./reviewer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Email capture file
const SUBSCRIBERS_FILE = path.join(__dirname, '..', 'subscribers.json');

// ============================================
// PER-REPO CONFIGURATION (Pro Feature)
// ============================================
const CONFIG_FILE = path.join(__dirname, '..', 'repo-configs.json');

function loadConfigs() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    }
  } catch (e) { console.error('Error loading configs:', e.message); }
  return {};
}

function saveConfig(owner, repo, config) {
  const configs = loadConfigs();
  const key = `${owner}/${repo}`;
  configs[key] = { ...configs[key], ...config, updated: new Date().toISOString() };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2));
  return configs[key];
}

function getConfig(owner, repo) {
  const configs = loadConfigs();
  return configs[`${owner}/${repo}`] || {};
}

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

app.get('/health', (req, res) => {
  const mem = process.memoryUsage();
  res.json({ 
    status: 'ok', 
    service: 'ai-pr-reviewer',
    version: '1.1.0',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + 'MB'
    }
  });
});

// Webhook test endpoint - helps users verify GitHub App configuration
app.get('/webhook/test', (req, res) => {
  const required = ['GITHUB_APP_ID', 'GITHUB_PRIVATE_KEY', 'GITHUB_WEBHOOK_SECRET', 'ANTHROPIC_API_KEY'];
  const missing = required.filter(v => !process.env[v]);
  
  res.json({
    service: 'ai-pr-reviewer',
    endpoint: '/webhook/test',
    status: missing.length === 0 ? 'ready' : 'misconfigured',
    timestamp: new Date().toISOString(),
    required_env_vars: required,
    missing: missing,
    webhook_url: `https://${req.get('host')}/webhook`,
    setup_steps: [
      '1. Create GitHub App at https://github.com/settings/apps/new',
      '2. Set Webhook URL to: https://' + req.get('host') + '/webhook',
      '3. Grant Pull request: read and Issues: read permissions',
      '4. Subscribe to Pull request events',
      '5. Install on your repository'
    ]
  });
});

// Test webhook delivery - simulates a PR event
app.post('/webhook/test', express.json(), (req, res) => {
  const { action, pull_request, repository } = req.body;
  
  // Validate it's a test payload
  if (!pull_request || !repository) {
    return res.status(400).json({
      error: 'Invalid test payload',
      hint: 'Send a payload with pull_request and repository fields'
    });
  }
  
  res.json({
    received: true,
    action: action || 'test',
    repo: repository.full_name,
    pr: pull_request.number,
    message: 'Webhook received! If configured correctly, AI review will be posted.'
  });
});

// Prometheus-style metrics endpoint
app.get('/metrics', (req, res) => {
  const subscribers = loadSubscribers();
  const proCount = subscribers.filter(s => {
    const PRO_TIERS = ['pro', 'business', 'enterprise'];
    return PRO_TIERS.includes(s.tier);
  }).length;
  
  let totalReviews = 0;
  for (const count of usageStore.values()) {
    totalReviews += count;
  }
  
  const mem = process.memoryUsage();
  
  res.set('Content-Type', 'text/plain');
  res.send(`# AI PR Reviewer Metrics
ai_pr_reviewer_uptime_seconds ${Math.floor(process.uptime())}
ai_pr_reviewer_total_reviews ${totalReviews}
ai_pr_reviewer_free_users ${subscribers.length - proCount}
ai_pr_reviewer_pro_users ${proCount}
ai_pr_reviewer_tracked_repos ${usageStore.size}
ai_pr_reviewer_memory_rss_bytes ${mem.rss}
ai_pr_reviewer_memory_heap_used_bytes ${mem.heapUsed}
`);
});

// JSON metrics endpoint for programmatic access
app.get('/metrics/json', (req, res) => {
  const subscribers = loadSubscribers();
  const proCount = subscribers.filter(s => {
    const PRO_TIERS = ['pro', 'business', 'enterprise'];
    return PRO_TIERS.includes(s.tier);
  }).length;
  
  let totalReviews = 0;
  for (const count of usageStore.values()) {
    totalReviews += count;
  }
  
  const mem = process.memoryUsage();
  
  res.json({
    service: 'ai-pr-reviewer',
    version: '1.3.0',
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    metrics: {
      total_reviews: totalReviews,
      free_users: subscribers.length - proCount,
      pro_users: proCount,
      tracked_repos: usageStore.size
    },
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024)
    }
  });
});

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

// ============================================
// PER-REPO CONFIGURATION API (Pro Feature)
// ============================================

// Get config for a specific repo
app.get('/config/:owner/:repo', (req, res) => {
  const { owner, repo } = req.params;
  const config = getConfig(owner, repo);
  
  // Mask sensitive data
  const safeConfig = { ...config };
  delete safeConfig.stripeCustomerId;
  delete safeConfig.proApiKey;
  
  res.json({
    repo: `${owner}/${repo}`,
    config: safeConfig,
    isPro: !!config.isPro
  });
});

// Set config for a specific repo (Pro feature)
app.post('/config/:owner/:repo', (req, res) => {
  const { owner, repo } = req.params;
  const { 
    isPro, 
    customPrompt, 
    filters, 
    labelSet,
    slackWebhook,
    discordWebhook,
    notifyOn,
    autoApproveSafe
  } = req.body;
  
  const currentConfig = getConfig(owner, repo);
  
  // Only allow Pro features if isPro is set
  const newConfig = {};
  if (isPro || currentConfig.isPro) {
    newConfig.isPro = true;
    if (customPrompt) newConfig.customPrompt = customPrompt;
    if (filters) newConfig.filters = filters;
    if (labelSet) newConfig.labelSet = labelSet;
    if (slackWebhook) newConfig.slackWebhook = slackWebhook;
    if (discordWebhook) newConfig.discordWebhook = discordWebhook;
    if (notifyOn) newConfig.notifyOn = notifyOn;
    if (autoApproveSafe !== undefined) newConfig.autoApproveSafe = autoApproveSafe;
  }
  
  const saved = saveConfig(owner, repo, newConfig);
  
  // Mask sensitive data in response
  delete saved.slackWebhook;
  delete saved.discordWebhook;
  
  res.json({
    ok: true,
    repo: `${owner}/${repo}`,
    config: saved,
    message: saved.isPro ? 'Pro features enabled' : 'Config saved (upgrade to Pro for advanced features)'
  });
});

// ============================================
// STRIPE CHECKOUT (Pro Feature)
// ============================================

const stripe = require('stripe');
let stripeClient = null;

// Initialize Stripe if key is provided
if (process.env.STRIPE_SECRET_KEY) {
  stripeClient = stripe(process.env.STRIPE_SECRET_KEY);
}

// Create Stripe checkout session for Pro subscription
app.post('/checkout', async (req, res) => {
  const { email, repo, successUrl, cancelUrl } = req.body;
  
  if (!stripeClient) {
    return res.status(503).json({ error: 'Payments not configured. Contact support.' });
  }
  
  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }
  
  try {
    const priceId = process.env.STRIPE_PRICE_ID || 'price_pro_monthly';
    
    const session = await stripeClient.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl || process.env.SUCCESS_URL || 'https://aiprreviewer.dev/pro?success=true',
      cancel_url: cancelUrl || process.env.CANCEL_URL || 'https://aiprreviewer.dev/pro?cancelled=true',
      metadata: {
        repo: repo || 'all',
        tier: 'pro'
      }
    });
    
    // Store pending subscription
    const configs = loadConfigs();
    if (repo) {
      const key = repo;
      configs[key] = configs[key] || {};
      configs[key].pendingSubscription = session.id;
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2));
    }
    
    res.json({ sessionId: session.id, url: session.url });
  } catch (e) {
    console.error('Stripe error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Stripe webhook handler
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripeClient) {
    return res.status(503).json({ error: 'Stripe not configured' });
  }
  
  const sig = req.headers['stripe-signature'];
  let event;
  
  try {
    event = stripeClient.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    console.error('Stripe webhook error:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }
  
  // Handle subscription events
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const repo = session.metadata?.repo;
    
    if (repo && repo !== 'all') {
      const [owner, reponame] = repo.split('/');
      saveConfig(owner, reponame, { 
        isPro: true, 
        stripeCustomerId: session.customer,
        subscriptionId: session.subscription
      });
      console.log(`✅ Pro activated for ${repo}`);
    }
  }
  
  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    // Find and update configs with this customer
    const configs = loadConfigs();
    for (const [key, config] of Object.entries(configs)) {
      if (config.stripeCustomerId === subscription.customer) {
        config.isPro = false;
        config.subscriptionId = null;
        console.log(`❌ Pro deactivated for ${key}`);
      }
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2));
  }
  
  res.json({ received: true });
});

// Check Pro status
app.get('/pro/status', (req, res) => {
  const { repo } = req.query;
  
  if (!repo) {
    return res.status(400).json({ error: 'repo required' });
  }
  
  const [owner, reponame] = repo.split('/');
  const config = getConfig(owner, reponame);
  
  res.json({
    repo,
    isPro: !!config.isPro,
    features: config.isPro ? [
      'custom_prompts',
      'per_repo_config',
      'slack_notifications',
      'discord_notifications',
      'filters',
      'bulk_operations',
      'team_analytics'
    ] : []
  });
});

// ============================================
// SLACK/DISCORD NOTIFICATIONS (Pro Feature)
// ============================================

async function sendSlackNotification(webhookUrl, message, repo) {
  if (!webhookUrl) return;
  
  try {
    const fetch = (await import('node-fetch')).default;
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `🤖 *AI PR Review* - ${repo}`,
        blocks: [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: message }
          }
        ]
      })
    });
  } catch (e) {
    console.error('Slack notification error:', e.message);
  }
}

async function sendDiscordNotification(webhookUrl, message, repo) {
  if (!webhookUrl) return;
  
  try {
    const fetch = (await import('node-fetch')).default;
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🤖 **AI PR Review** - ${repo}`,
        embeds: [{
          description: message,
          color: 5814783
        }]
      })
    });
  } catch (e) {
    console.error('Discord notification error:', e.message);
  }
}

// Test notification endpoint
app.post('/notify/test', async (req, res) => {
  const { type, webhook, repo } = req.body;
  
  if (!webhook || !type) {
    return res.status(400).json({ error: 'type and webhook required' });
  }
  
  const testMessage = '✅ Test notification from AI PR Reviewer!';
  
  if (type === 'slack') {
    await sendSlackNotification(webhook, testMessage, repo || 'test-repo');
  } else if (type === 'discord') {
    await sendDiscordNotification(webhook, testMessage, repo || 'test-repo');
  } else {
    return res.status(400).json({ error: 'type must be slack or discord' });
  }
  
  res.json({ ok: true, message: 'Test notification sent' });
});

app.post('/webhook', handleWebhook);

// ============================================
// NEW: Team Analytics Dashboard (Pro Feature)
// ============================================

// In-memory analytics store (use Redis in production)
const analyticsStore = {
  reviews: [],  // { repo, pr, author, timestamp, stats, size, score }
  dailyStats: new Map()  // "2026-03-06" -> { reviews: 0, repos: Set, authors: Set }
};

function recordReviewAnalytics(repoFullName, prNumber, author, diffStats, qualityScore) {
  const timestamp = new Date();
  const dateKey = timestamp.toISOString().split('T')[0];
  
  // Record individual review
  analyticsStore.reviews.push({
    repo: repoFullName,
    pr: prNumber,
    author,
    timestamp: timestamp.toISOString(),
    stats: diffStats,
    score: qualityScore
  });
  
  // Keep only last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  analyticsStore.reviews = analyticsStore.reviews.filter(r => 
    new Date(r.timestamp) > thirtyDaysAgo
  );
  
  // Update daily stats
  if (!analyticsStore.dailyStats.has(dateKey)) {
    analyticsStore.dailyStats.set(dateKey, { 
      reviews: 0, 
      repos: new Set(), 
      authors: new Set(),
      totalLines: 0,
      avgSize: 0
    });
  }
  const day = analyticsStore.dailyStats.get(dateKey);
  day.reviews++;
  day.repos.add(repoFullName);
  day.authors.add(author);
  day.totalLines += diffStats.totalLines;
}

function getTeamAnalytics(repoFullName, days = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  
  const reviews = analyticsStore.reviews.filter(r => 
    new Date(r.timestamp) > cutoff && (!repoFullName || r.repo === repoFullName)
  );
  
  // Group by author
  const byAuthor = {};
  reviews.forEach(r => {
    if (!byAuthor[r.author]) {
      byAuthor[r.author] = { prs: 0, linesAdded: 0, linesRemoved: 0, avgScore: 0, scores: [] };
    }
    byAuthor[r.author].prs++;
    byAuthor[r.author].linesAdded += r.stats?.linesAdded || 0;
    byAuthor[r.author].linesRemoved += r.stats?.linesRemoved || 0;
    if (r.score?.overall) {
      byAuthor[r.author].scores.push(r.score.overall);
    }
  });
  
  // Calculate averages
  Object.values(byAuthor).forEach(a => {
    a.avgScore = a.scores.length > 0 
      ? Math.round(a.scores.reduce((s, v) => s + v, 0) / a.scores.length)
      : null;
    delete a.scores;
  });
  
  // Group by day
  const byDay = {};
  reviews.forEach(r => {
    const day = r.timestamp.split('T')[0];
    if (!byDay[day]) byDay[day] = { reviews: 0, prs: 0, lines: 0 };
    byDay[day].reviews++;
    byDay[day].prs++;
    byDay[day].lines += r.stats?.totalLines || 0;
  });
  
  // Summary stats
  const totalLines = reviews.reduce((sum, r) => sum + (r.stats?.totalLines || 0), 0);
  const avgReviewSize = reviews.length > 0 ? Math.round(totalLines / reviews.length) : 0;
  
  return {
    summary: {
      totalReviews: reviews.length,
      uniqueAuthors: Object.keys(byAuthor).length,
      totalLinesChanged: totalLines,
      avgReviewSize: avgReviewSize,
      period: days
    },
    byAuthor,
    byDay
  };
}

// Team analytics endpoint (Pro feature)
app.get('/analytics', (req, res) => {
  const { repo, days } = req.query;
  const analytics = getTeamAnalytics(repo, parseInt(days) || 30);
  
  // Add velocity metrics
  const velocity = calculateVelocity(analytics);
  analytics.velocity = velocity;
  
  res.json(analytics);
});

function calculateVelocity(analytics) {
  const { byDay, summary } = analytics;
  const days = Object.keys(byDay).sort();
  
  if (days.length < 2) {
    return { trend: 'insufficient_data', avgReviewsPerDay: 0 };
  }
  
  // Calculate trend
  const firstHalf = days.slice(0, Math.floor(days.length / 2));
  const secondHalf = days.slice(Math.floor(days.length / 2));
  
  const firstAvg = firstHalf.reduce((sum, d) => sum + byDay[d].reviews, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, d) => sum + byDay[d].reviews, 0) / secondHalf.length;
  
  let trend = 'stable';
  if (secondAvg > firstAvg * 1.2) trend = 'improving';
  else if (secondAvg < firstAvg * 0.8) trend = 'declining';
  
  return {
    trend,
    avgReviewsPerDay: Math.round(summary.totalReviews / days.length),
    mostActiveDay: Object.entries(byDay).sort((a, b) => b[1].reviews - a[1].reviews)[0]?.[0],
    mostActiveAuthor: Object.entries(analytics.byAuthor).sort((a, b) => b[1].prs - a[1].prs)[0]?.[0]
  };
}

// Review analytics endpoint - call after each PR review
app.post('/analytics/record', (req, res) => {
  const { repo, pr, author, stats, score } = req.body;
  if (!repo || !pr) {
    return res.status(400).json({ error: 'repo and pr required' });
  }
  recordReviewAnalytics(repo, pr, author, stats, score);
  res.json({ ok: true });
});

// NEW: PR Description Generator endpoint
app.post('/describe', async (req, res) => {
  const { diff } = req.body;
  if (!diff) return res.status(400).json({ error: 'Diff required' });
  
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }
  
  try {
    const description = await generateDescription(diff);
    const stats = extractDiffStats(diff);
    const files = extractFileChanges(diff);
    
    res.json({
      description,
      stats,
      files
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// NEW: PR Size Analysis endpoint
app.post('/analyze', (req, res) => {
  const { diff } = req.body;
  if (!diff) return res.status(400).json({ error: 'Diff required' });
  
  const analysis = analyzePRSize(diff);
  res.json(analysis);
});

// NEW: Quick Security Scan (free tier, no AI required)
app.post('/scan/quick', (req, res) => {
  const { diff } = req.body;
  if (!diff) return res.status(400).json({ error: 'Diff required' });
  
  const result = quickSecurityScan(diff);
  res.json(result);
});

// NEW: Get diff statistics endpoint
app.post('/stats/diff', (req, res) => {
  const { diff } = req.body;
  if (!diff) return res.status(400).json({ error: 'Diff required' });
  
  const stats = extractDiffStats(diff);
  const files = extractFileChanges(diff);
  
  res.json({ stats, files });
});

// NEW: PR Summary endpoint (Pro feature) - High-level overview for team leads
app.post('/summary', async (req, res) => {
  const { diff, prTitle, prBody } = req.body;
  if (!diff) return res.status(400).json({ error: 'Diff required' });
  
  // Check if Pro feature is enabled
  const isPro = process.env.DEFAULT_PRO === 'true';
  if (!isPro) {
    return res.status(403).json({ 
      error: 'PR Summary is a Pro feature',
      upgrade: 'https://aiprreviewer.dev/#pricing'
    });
  }
  
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }
  
  try {
    const stats = extractDiffStats(diff);
    const files = extractFileChanges(diff);
    const analysis = analyzePRSize(diff);
    
    // Generate AI summary if API key available
    let aiSummary = null;
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      
      const prompt = `Analyze this PR and provide a brief executive summary (2-3 sentences max):
      
PR Title: ${prTitle || 'N/A'}
PR Body: ${prBody || 'N/A'}

Files changed: ${files.map(f => f.file).join(', ')}

Diff stats: ${stats.filesChanged} files, +${stats.additions} lines, -${stats.deletions} lines

Provide a summary a team lead would understand. Focus on what this PR does at a high level.`;

      const response = await client.messages.create({
        model: process.env.AI_MODEL || 'claude-haiku-4-5',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }]
      });
      
      aiSummary = response.content[0].text;
    } catch (e) {
      console.error('AI summary error:', e.message);
    }
    
    res.json({
      summary: aiSummary || 'Enable Pro to get AI-powered summaries',
      stats,
      files: files.slice(0, 10), // Top 10 files
      analysis,
      isPro: true
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`🤖 AI PR Reviewer running on port ${PORT}`));
