const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');

function getOctokit(installationId) {
  if (!process.env.GITHUB_PRIVATE_KEY) {
    throw new Error('GITHUB_PRIVATE_KEY environment variable is required');
  }
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

async function postReviewComment(octokit, owner, repo, pull_number, body, diff = null) {
  // Try to post as a proper PR review with review API
  try {
    // Parse body for line-specific comments (format: FILE:LINE:COMMENT)
    const lineComments = [];
    const lines = body.split('\n');
    let currentSection = 'general';
    
    // Extract file paths from diff to build proper comments
    // For now, post as review comment - more visible than issue comment
    await octokit.rest.pulls.createReview({
      owner,
      repo,
      pull_number,
      body: `## 🤖 AI Code Review\n\n${body}\n\n---\n*Powered by Claude AI*`,
      event: 'COMMENT', // Use COMMENT instead of APPROVE or REQUEST_CHANGES
    });
    console.log(`✅ Posted PR review to ${owner}/${repo}#${pull_number}`);
  } catch (error) {
    // Fallback to issue comment if PR review API fails
    console.log(`⚠️ PR review API failed, using issue comment: ${error.message}`);
    await octokit.rest.issues.createComment({
      owner, repo,
      issue_number: pull_number,
      body: `## 🤖 AI Code Review\n\n${body}\n\n---\n*Powered by Claude AI*`,
    });
  }
}

module.exports = { getOctokit, getPRDiff, postReviewComment };
