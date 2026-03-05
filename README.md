# 🤖 AI PR Reviewer

Automated AI-powered code review for GitHub Pull Requests using Claude AI.

## Features

- **Automatic Reviews**: Every PR gets an AI-powered review within minutes
- **Proper PR Reviews**: Shows in the "Reviews" tab (not just issue comments)
- **Approve/Request Changes**: Can optionally approve or request changes
- **Security Analysis**: Detects common vulnerabilities and security issues (Pro)
- **Code Quality**: Suggests improvements for readability and performance
- **Best Practices**: Checks for language-specific best practices
- **Usage Tracking**: Built-in stats endpoint for monitoring (Pro tier limiting)
- **PR Statistics**: Shows files changed, lines added/removed, languages detected
- **Multi-Language Support**: Python, JavaScript, TypeScript, Go, Rust, and more
- **Structured Feedback**: Organized by Security, Bugs, Improvements, and Good Practices

## Pricing

**Free Tier**: 10 PR reviews/month, public repos only
**Pro ($29/month)**: Unlimited PR reviews for private repositories
- 🔒 Advanced security vulnerability scanning (SQL injection, XSS, command injection, SSRF, XXE, and 20+ more)
- 📊 Code quality scoring (Readability, Maintainability, Error Handling, Performance)
- 🎯 Detailed PR summary and overview
- Custom review prompts
- Priority support
- Slack/Discord integration
- Detailed PR statistics

⏳ Pro access coming soon - [Join waitlist](https://forms.gle/waitlist)

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
   - `ENABLE_SECURITY_SCAN` - Set to "true" for Pro security features
4. Install the GitHub App on your repository
5. Visit `/setup` endpoint to verify configuration

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `GITHUB_WEBHOOK_SECRET` | Webhook secret for verification |
| `ENABLE_SECURITY_SCAN` | Enable advanced security scanning (Pro) |
| `ENABLE_QUALITY_SCORE` | Enable code quality scoring (Pro) |
| `AI_MODEL` | Override default model (e.g., claude-opus-4-6) |
| `FREE_TIER_LIMIT` | Free tier PR limit (default: 10/month) |

## API Endpoints

- `GET /health` - Health check
- `GET /status` - Comprehensive status (config, usage, API connectivity test)
- `GET /setup` - Verify configuration
- `GET /stats/:owner/:repo` - Usage statistics for a repository
- `GET /stats` - Global usage statistics across all tracked repos
- `POST /subscribe` - Join waitlist (email required in body)
- `GET /subscribers/count` - Get subscriber count (for analytics)

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

> ## 🔒 Security Scan Results
> 
> ⚠️ **Critical**: Potential SQL injection in `db/query.js:23`
> ```js
> query("SELECT * FROM users WHERE id = " + userId)
> ```
> **Fix**: Use parameterized queries
> 
> ## 🐛 Bugs & Issues
> 
> - Null check missing in `utils.js:15` - may cause runtime error
> 
> ## 💡 Code Improvements
> 
> - Consider using `const` instead of `var` in `utils.js:5`
> 
> ## ✅ Good Practices
> 
> - Proper error handling in `api/routes.js:12`
> 
> ---
> **Severity**: 🟡 Medium | **Confidence**: 8/10

## License

MIT
