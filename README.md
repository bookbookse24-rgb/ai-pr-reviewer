# 🤖 AI PR Reviewer

Automated AI-powered code review for GitHub Pull Requests using Claude AI.

## Features

- **Automatic Reviews**: Every PR gets an AI-powered review within minutes
- **Security Analysis**: Detects common vulnerabilities and security issues
- **Code Quality**: Suggests improvements for readability and performance
- **Best Practices**: Checks for language-specific best practices
- **Multi-Language Support**: Python, JavaScript, TypeScript, Go, Rust, and more

## Pricing

**Free Tier**: 10 PR reviews/month, public repos only
**Pro ($29/month)**: Unlimited PR reviews for private repositories
- Security vulnerability scanning
- Code quality scoring
- Custom review prompts
- Priority support
- Slack/Discord integration

👉 [Get Pro on Gumroad](https://gumroad.com/l/ai-pr-reviewer-pro)

## Setup

1. Create a GitHub App at https://github.com/settings/apps/new
   - **Webhook URL**: Your deployed URL (e.g., https://your-app.onrender.com/webhook)
   - **Permissions**: Pull requests (read), Issues (read)
   - Subscribe to: Pull request events
2. Deploy to [Render.com](https://render.com/deploy?repo=https://github.com/bookbookse24-rgb/ai-pr-reviewer)
3. Set environment variables:
   - `ANTHROPIC_API_KEY` - Your Anthropic API key
   - `GITHUB_APP_ID` - From GitHub App settings
   - `GITHUB_PRIVATE_KEY` - Private key from GitHub App (replace newlines with \n)
   - `GITHUB_WEBHOOK_SECRET` - Generate a secure random string
4. Install the GitHub App on your repository
5. Visit `/setup` endpoint to verify configuration

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `GITHUB_WEBHOOK_SECRET` | Webhook secret for verification |

## Deploy

### Docker
```bash
docker run -d -p 3000:3000 \
  -e ANTHROPIC_API_KEY=your-key \
  -e GITHUB_WEBHOOK_SECRET=secret \
  ghcr.io/bookbookse24-rgb/ai-pr-reviewer:latest
```

### Render
Click the deploy button in render.yaml

## Example Review

The AI will analyze your PR and provide feedback like:

> **Security**: ⚠️ Potential SQL injection detected in `db/query.js`
> 
> **Code Quality**: Consider using `const` instead of `var` in `utils.js:5`
> 
> **Best Practices**: Add error handling for async function in `api/routes.js:12`

## License

MIT
