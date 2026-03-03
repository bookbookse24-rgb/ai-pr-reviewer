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
- 🐛 **Bugs & Logic Errors** — incorrect logic, off-by-one errors, null/undefined issues
- 🔒 **Security Vulnerabilities** — SQL injection, XSS, hardcoded secrets, improper auth, command injection, path traversal
- ⚡ **Performance Issues** — unnecessary loops, missing indexes, N+1 queries, memory leaks
- 🏗️ **Code Quality** — naming, complexity, duplication, SOLID principles
- ❌ **Missing Error Handling** — unhandled promises, missing try/catch, no input validation
- 📝 **Documentation** — missing docs for public APIs, uncommented complex logic

Format your response as markdown with these sections:
1. **Security Alert** 🔒 - Critical security issues (must fix!)
2. **Bugs & Issues** 🐛 - Logic errors and bugs
3. **Code Improvements** 💡 - Suggestions for better code
4. **Good Practices** ✅ - What's done well

End with:
- Overall severity: 🟢 Low / 🟡 Medium / 🔴 High
- Confidence score: X/10

PR Diff:
\`\`\`diff
${diff}
\`\`\``;
};

const SECURITY_SCAN_PROMPT = (diff) => `You are a security expert. Perform a focused security scan on this PR diff.

Search for:
- 🔴 **Critical**: SQL injection, command injection, hardcoded passwords/keys/secrets, authentication bypass, path traversal, XXE
- 🟠 **High**: XSS vulnerabilities, CSRF issues, insecure deserialization, weak crypto
- 🟡 **Medium**: Information disclosure, missing rate limiting, improper error handling

For each finding, provide:
1. File and line number
2. Severity (Critical/High/Medium)
3. Description
4. Recommended fix

If no issues found, return: "✅ Security scan passed - no vulnerabilities detected."

PR Diff:
\`\`\`diff
${diff}
\`\`\``;

module.exports = { REVIEW_PROMPT, SECURITY_SCAN_PROMPT };
