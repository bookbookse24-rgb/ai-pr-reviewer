const crypto = require('crypto');
const { getOctokit, getPRDiff, postReviewComment } = require('./github');
const { reviewCode } = require('./reviewer');

function verifySignature(req) {
  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;
  const hmac = crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET);
  const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(digest));
}

async function handleWebhook(req, res) {
  if (!verifySignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.headers['x-github-event'];
  const payload = req.body;

  if (event !== 'pull_request') return res.json({ ok: true, skipped: true });
  if (!['opened', 'synchronize'].includes(payload.action)) return res.json({ ok: true, skipped: true });

  res.json({ ok: true, message: 'Review queued' });

  try {
    const { repository, pull_request, installation } = payload;
    const octokit = getOctokit(installation.id);
    const diff = await getPRDiff(octokit, repository.owner.login, repository.name, pull_request.number);
    const review = await reviewCode(diff);
    if (review) {
      await postReviewComment(octokit, repository.owner.login, repository.name, pull_request.number, review);
      console.log(`✅ Reviewed PR #${pull_request.number} in ${repository.full_name}`);
    }
  } catch (err) {
    console.error('Review error:', err.message);
  }
}

module.exports = { handleWebhook };
