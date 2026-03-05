const REVIEW_PROMPT = (diff, stats = {}) => {
  const statsSection = stats.filesChanged ? `
## PR Statistics
- Files changed: ${stats.filesChanged}
- Lines added: ${stats.linesAdded}
- Lines removed: ${stats.linesRemoved}
- Languages: ${stats.languages || 'Unknown'}
` : '';

  return `You are an expert code reviewer. Review the following pull request diff and provide clear, actionable feedback.${statsSection}

Check for:
- 🐛 **Bugs & Logic Errors** — incorrect logic, off-by-one errors, null/undefined issues, race conditions
- 🔒 **Security Vulnerabilities** — SQL injection, XSS, hardcoded secrets, improper auth, command injection, path traversal, SSRF, insecure dependencies
- ⚡ **Performance Issues** — unnecessary loops, missing indexes, N+1 queries, memory leaks, inefficient algorithms
- 🏗️ **Code Quality** — naming, complexity (>20 cyclomatic), duplication, SOLID principles, DRY
- ❌ **Missing Error Handling** — unhandled promises, missing try/catch, no input validation, silent failures
- 📝 **Documentation** — missing docs for public APIs, uncommented complex logic, missing type hints
- 🔄 **API Changes** — breaking changes, missing backward compatibility, version bumps

Format your response as markdown with these sections:
1. **Security Alert** 🔒 - Critical security issues (must fix!)
2. **Bugs & Issues** 🐛 - Logic errors and bugs
3. **Code Improvements** 💡 - Suggestions for better code
4. **Good Practices** ✅ - What's done well
5. **Summary** 📋 - Brief one-paragraph overview of the PR purpose and quality

End with:
- Overall severity: 🟢 Low / 🟡 Medium / 🔴 High
- Confidence score: X/10
- Code Quality Score: X/100 (based on: readability, maintainability, error handling, performance, security)

PR Diff:
\`\`\`diff
${diff}
\`\`\``;
};

// Code quality scoring prompt - extracts numeric scores
const CODE_QUALITY_PROMPT = (diff) => `Analyze this PR diff and provide numeric quality scores.

For each category, score 0-100:
- **Readability** (25 pts): Clear naming, consistent style, appropriate comments
- **Maintainability** (25 pts): Low complexity, DRY, good abstractions, modular
- **Error Handling** (25 pts): Proper try/catch, validation, graceful failures
- **Performance** (25 pts): Efficient algorithms, no N+1, proper resource management

Return ONLY a JSON object with this exact format:
{
  "readability": 85,
  "maintainability": 70,
  "errorHandling": 90,
  "performance": 75,
  "overall": 80,
  "summary": "Brief one-sentence summary"
}

PR Diff:
\`\`\`diff
${diff}
\`\`\``;

const SECURITY_SCAN_PROMPT = (diff) => `You are a security expert. Perform a comprehensive security scan on this PR diff.

Search for these specific vulnerability patterns:
- 🔴 **Critical**: 
  - SQL injection: user input in queries (\`SELECT * FROM users WHERE id = \` + input)
  - Command injection: exec(), system(), child_process with unsanitized input
  - Hardcoded secrets: passwords, API keys, tokens, private keys in code (\`password =\`, \`apiKey =\`, \`token =\`)
  - Authentication bypass: missing auth checks, disabled security middleware
  - Path traversal: \`../\` in file paths without validation
  - XXE: XML external entity parsing
  - Insecure randomness: Math.random() for security-sensitive operations

- 🟠 **High**: 
  - XSS: innerHTML, dangerouslySetInnerHTML, document.write with user input
  - CSRF: missing CSRF tokens on state-changing operations
  - Insecure deserialization: JSON.parse of untrusted data without validation
  - Weak crypto: MD5, SHA1 for passwords, ECB mode, weak key sizes
  - SSRF: fetching URLs from user input without validation
  - Open redirect: unvalidated redirects

- 🟡 **Medium**: 
  - Information disclosure: stack traces, error messages exposed to users
  - Missing rate limiting on APIs
  - Improper error handling revealing sensitive info
  - Insecure cookie settings (missing HttpOnly, Secure, SameSite)
  - TODO/FIXME comments mentioning security issues
  - Dependency vulnerabilities (suspicious require/import of known-vulnerable packages)

For each finding, provide:
1. File and line number (use git hunk headers like \`+++ b/src/file.js:23\`)
2. Severity (Critical/High/Medium)
3. Description - what the vulnerability is
4. Code snippet showing the issue
5. Recommended fix with corrected code

If no issues found, return: "✅ Security scan passed - no vulnerabilities detected."

PR Diff:
\`\`\`diff
${diff}
\`\`\``;

module.exports = { REVIEW_PROMPT, SECURITY_SCAN_PROMPT, CODE_QUALITY_PROMPT };
