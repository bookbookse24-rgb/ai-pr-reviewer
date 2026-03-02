# 🤖 AI PR Reviewer

Automated AI-powered code review for GitHub Pull Requests using Claude AI.

## Features

- **Automatic Reviews**: Every PR gets an AI-powered review within minutes
- **Security Analysis**: Detects common vulnerabilities and security issues
- **Code Quality**: Suggests improvements for readability and performance
- **Best Practices**: Checks for language-specific best practices
- **Multi-Language Support**: Python, JavaScript, TypeScript, Go, Rust, and more

## Pricing

**$29/month** - Unlimited PR reviews for private repositories

## Setup

1. Go to [Render.com deployment](#) or use Docker
2. Set `ANTHROPIC_API_KEY` environment variable
3. Install GitHub App on your repository
4. Enjoy automated PR reviews!

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
