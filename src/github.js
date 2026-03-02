const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');

function getOctokit(installationId) {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'),
      installationId,
    },
  });
}

async function getPRDiff(octokit, owner, repo, pull_number) {
  const { data } = await octokit.rest.pulls.get({
    owner, repo, pull_number,
    mediaType: { format: 'diff' },
  });
  return data;
}

async function postReviewComment(octokit, owner, repo, pull_number, body) {
  await octokit.rest.issues.createComment({
    owner, repo,
    issue_number: pull_number,
    body: `## 🤖 AI Code Review\n\n${body}\n\n---\n*Powered by Claude AI*`,
  });
}

module.exports = { getOctokit, getPRDiff, postReviewComment };
