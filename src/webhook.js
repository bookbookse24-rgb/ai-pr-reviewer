const crypto = require('crypto');
const { getOctokit, getPRDiff, postReviewComment } = require('./github');
const { reviewCode } = require('./reviewer');
const { trackUsage, getUsage } = require('./index');

function verifySignature(req) {
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;
  const hmac = crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(digest));
}

async function handleWebhook(req, res) {
  // Validate required environment variables
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }
  if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_PRIVATE_KEY) {
    return res.status(500).json({ error: 'GitHub App credentials not configured' });
  }
  
  if (!verifySignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.headers['x-github-event'];
  const payload = req.body;

  if (event !== 'pull_request') return res.json({ ok: true, skipped: true });
  if (!['opened', 'synchronize'].includes(payload.action)) return res.json({ ok: true, skipped: true });

  // Check usage limits for free tier
  const repoFullName = payload.repository.full_name;
  const freeLimit = parseInt(process.env.FREE_TIER_LIMIT) || 10;
  const usage = getUsage(repoFullName);
  
  if (usage.today >= freeLimit) {
    return res.json({ 
      ok: false, 
      error: 'Free tier limit reached',
      upgrade: 'Pro tier required for unlimited reviews'
    });
  }

  // Track this review
  trackUsage(repoFullName);

  // Check if security scan is enabled (Pro feature)
  const securityScanEnabled = process.env.ENABLE_SECURITY_SCAN === 'true';

  res.json({ ok: true, message: 'Review queued' });

  try {
    const { repository, pull_request, installation } = payload;
    const octokit = getOctokit(installation.id);
    const diff = await getPRDiff(octokit, repository.owner.login, repository.name, pull_request.number);
    const review = await reviewCode(diff, { securityScan: securityScanEnabled });
    if (review) {
      await postReviewComment(octokit, repository.owner.login, repository.name, pull_request.number, review);
      console.log(`✅ Reviewed PR #${pull_request.number} in ${repository.full_name}${securityScanEnabled ? ' (with security scan)' : ''}`);
    }
  } catch (err) {
    console.error('Review error:', err.message);
  }
}

module.exports = { handleWebhook };
