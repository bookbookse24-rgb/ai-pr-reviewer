const Anthropic = require('@anthropic-ai/sdk');
const { REVIEW_PROMPT, SECURITY_SCAN_PROMPT, CODE_QUALITY_PROMPT, DESCRIPTION_PROMPT } = require('./prompts');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Configurable model - defaults to sonnet for better quality
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MODEL = process.env.AI_MODEL || DEFAULT_MODEL;

// PR Size thresholds
const PR_SIZE = {
  SMALL: 100,      // lines - quick review
  MEDIUM: 300,     // lines - normal review
  LARGE: 500,      // lines - thorough review needed
  HUGE: 1000       // lines - consider splitting
};

// Extract statistics from diff
function extractDiffStats(diff) {
  if (!diff) return {};
  
  const filesChanged = (diff.match(/^diff --git/gm) || []).length;
  const linesAdded = (diff.match(/^\+/gm) || []).length - filesChanged;
  const linesRemoved = (diff.match(/^-/gm) || []).length - filesChanged;
  const totalLines = linesAdded + linesRemoved;
  
  // Determine PR size category
  let prSize = 'small';
  if (totalLines >= PR_SIZE.HUGE) prSize = 'huge';
  else if (totalLines >= PR_SIZE.LARGE) prSize = 'large';
  else if (totalLines >= PR_SIZE.MEDIUM) prSize = 'medium';
  
  // Simple language detection
  const languages = new Set();
  if (diff.includes('.js') || diff.includes('javascript')) languages.add('JavaScript');
  if (diff.includes('.ts') || diff.includes('.tsx')) languages.add('TypeScript');
  if (diff.includes('.py') || diff.includes('python')) languages.add('Python');
  if (diff.includes('.go')) languages.add('Go');
  if (diff.includes('.rs')) languages.add('Rust');
  if (diff.includes('.java')) languages.add('Java');
  if (diff.includes('.rb') || diff.includes('ruby')) languages.add('Ruby');
  if (diff.includes('.php')) languages.add('PHP');
  if (diff.includes('.sql')) languages.add('SQL');
  if (diff.includes('.sh') || diff.includes('bash')) languages.add('Shell');
  if (diff.includes('.css') || diff.includes('.scss') || diff.includes('.less')) languages.add('CSS');
  if (diff.includes('.html') || diff.includes('.htm')) languages.add('HTML');
  
  return {
    filesChanged,
    linesAdded,
    linesRemoved,
    totalLines,
    prSize,
    languages: languages.size > 0 ? Array.from(languages).join(', ') : 'Mixed'
  };
}

// NEW: Extract file changes summary from diff
function extractFileChanges(diff) {
  if (!diff) return [];
  
  const files = [];
  const fileRegex = /^diff --git a\/(.+?) b\/(.+?)$/gm;
  let match;
  
  while ((match = fileRegex.exec(diff)) !== null) {
    const filePath = match[1];
    // Get changes for this file
    const fileSection = diff.slice(match.index, diff.index + 2000);
    const nextMatch = fileRegex.exec(diff);
    const endIndex = nextMatch ? nextMatch.index : diff.length;
    const fileDiff = diff.slice(match.index, endIndex);
    
    const linesAdded = (fileDiff.match(/^\+/gm) || []).length - 1;
    const linesRemoved = (fileDiff.match(/^-/gm) || []).length - 1;
    
    // Determine file type
    let type = 'other';
    if (filePath.endsWith('.js') || filePath.endsWith('.ts') || filePath.endsWith('.jsx') || filePath.endsWith('.tsx')) {
      type = 'code';
    } else if (filePath.endsWith('.md')) {
      type = 'docs';
    } else if (filePath.endsWith('.json')) {
      type = 'config';
    } else if (filePath.endsWith('.css') || filePath.endsWith('.scss') || filePath.endsWith('.html')) {
      type = 'style';
    }
    
    files.push({
      path: filePath,
      added: linesAdded,
      removed: linesRemoved,
      type
    });
  }
  
  return files;
}

// NEW: Generate PR description from diff
async function generateDescription(diff) {
  if (!diff || diff.trim().length === 0) return null;
  
  const stats = extractDiffStats(diff);
  
  // Truncate if too long
  const maxChars = MODEL.includes('sonnet') ? 12000 : 8000;
  const truncated = diff.length > maxChars 
    ? diff.slice(0, maxChars) + `\n\n[Truncated at ${maxChars} chars]` 
    : diff;
  
  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{ role: 'user', content: DESCRIPTION_PROMPT(truncated, stats) }],
    });
    
    return message.content[0].text;
  } catch (e) {
    console.log('Description generation failed:', e.message);
    return null;
  }
}

// NEW: Analyze PR size and provide warnings
function analyzePRSize(diff) {
  const stats = extractDiffStats(diff);
  const warnings = [];
  
  if (stats.totalLines >= PR_SIZE.HUGE) {
    warnings.push({
      level: '🔴',
      type: 'size',
      message: `This PR has ${stats.totalLines} lines changed. Consider splitting into smaller PRs.`
    });
  } else if (stats.totalLines >= PR_SIZE.LARGE) {
    warnings.push({
      level: '🟠',
      type: 'size',
      message: `Large PR (${stats.totalLines} lines). Plan for thorough review.`
    });
  }
  
  if (stats.filesChanged >= 10) {
    warnings.push({
      level: '🟡',
      type: 'files',
      message: `${stats.filesChanged} files changed. Consider splitting by feature.`
    });
  }
  
  return {
    stats,
    warnings,
    recommendation: stats.totalLines >= PR_SIZE.HUGE 
      ? 'Consider splitting this PR into smaller, focused changes.'
      : 'PR size is manageable for review.'
  };
}

async function reviewCode(diff, options = {}) {
  if (!diff || diff.trim().length === 0) return null;

  const stats = extractDiffStats(diff);
  
  // Support longer diffs with sonnet (higher context window)
  const maxChars = MODEL.includes('sonnet') ? 15000 : 10000;
  const truncated = diff.length > maxChars 
    ? diff.slice(0, maxChars) + `\n\n[Diff truncated at ${maxChars} chars. Using ${MODEL}]` 
    : diff;

  // Run security scan separately if enabled (Pro feature)
  let securityFindings = '';
  if (options.securityScan) {
    try {
      const securityMsg = await client.messages.create({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: SECURITY_SCAN_PROMPT(truncated) }],
      });
      securityFindings = securityMsg.content[0].text;
    } catch (e) {
      console.log('Security scan skipped:', e.message);
    }
  }

  // Run code quality scoring if enabled (Pro feature)
  let qualityScore = null;
  if (options.qualityScore) {
    try {
      const qualityMsg = await client.messages.create({
        model: MODEL,
        max_tokens: 256,
        messages: [{ role: 'user', content: CODE_QUALITY_PROMPT(truncated) }],
      });
      const responseText = qualityMsg.content[0].text;
      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        qualityScore = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.log('Quality scoring skipped:', e.message);
    }
  }

  // Main review
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: REVIEW_PROMPT(truncated, stats) }],
  });

  // Combine security findings with main review
  let fullReview = message.content[0].text;
  if (securityFindings && !securityFindings.includes('no vulnerabilities detected')) {
    fullReview = `## 🔒 Security Scan Results\n\n${securityFindings}\n\n---\n\n${fullReview}`;
  }

  // Add quality score if available
  if (qualityScore) {
    const scoreSection = `\n---\n\n## 📊 Code Quality Score\n\n| Category | Score |\n|----------|-------|\n| Readability | ${qualityScore.readability}/100 |\n| Maintainability | ${qualityScore.maintainability}/100 |\n| Error Handling | ${qualityScore.errorHandling}/100 |\n| Performance | ${qualityScore.performance}/100 |\n| **Overall** | **${qualityScore.overall}/100** |\n\n${qualityScore.summary}`;
    fullReview += scoreSection;
  }

  return fullReview;
}

// Quick security scan - fast pattern-based detection without AI (free tier)
function quickSecurityScan(diff) {
  const findings = [];
  const lines = diff.split('\n');
  
  // Patterns to detect
  const patterns = [
    { regex: /password\s*=\s*['"`]/i, severity: 'HIGH', type: 'hardcoded_secret', message: 'Hardcoded password detected' },
    { regex: /api[_-]?key\s*=\s*['"`]/i, severity: 'HIGH', type: 'hardcoded_secret', message: 'Hardcoded API key detected' },
    { regex: /secret\s*=\s*['"`]/i, severity: 'HIGH', type: 'hardcoded_secret', message: 'Hardcoded secret detected' },
    { regex: /token\s*=\s*['"`]/i, severity: 'HIGH', type: 'hardcoded_secret', message: 'Hardcoded token detected' },
    { regex: /exec\s*\(\s*.*\+/i, severity: 'HIGH', type: 'command_injection', message: 'Potential command injection risk' },
    { regex: /system\s*\(/i, severity: 'HIGH', type: 'command_injection', message: 'System call with potential injection risk' },
    { regex: /eval\s*\(/i, severity: 'HIGH', type: 'code_injection', message: 'eval() is dangerous' },
    { regex: /innerHTML\s*=/i, severity: 'MEDIUM', type: 'xss', message: 'innerHTML assignment - potential XSS' },
    { regex: /dangerouslySetInnerHTML/i, severity: 'MEDIUM', type: 'xss', message: 'dangerouslySetInnerHTML - potential XSS' },
    { regex: /SELECT\s+.*\+\s*/i, severity: 'HIGH', type: 'sql_injection', message: 'Potential SQL injection' },
    { regex: /process\.env\.ANTHROPIC_API_KEY/i, severity: 'LOW', type: 'secret_leak', message: 'Reference to Anthropic API key' },
    { regex: /Math\.random\s*\(\s*\)/i, severity: 'MEDIUM', type: 'weak_random', message: 'Math.random() is not cryptographically secure' },
    { regex: /TODO.*password/i, severity: 'MEDIUM', type: 'todo_security', message: 'TODO comment about password - potential security issue' },
    { regex: /TODO.*security/i, severity: 'MEDIUM', type: 'todo_security', message: 'TODO comment about security' },
    { regex: /\.\.\//i, severity: 'LOW', type: 'path_traversal', message: 'Path traversal pattern - verify input validation' },
    { regex: /fetch\s*\(\s*.*\+/i, severity: 'MEDIUM', type: 'ssrf', message: 'Dynamic URL in fetch - potential SSRF' },
    { regex: /http:\/\//i, severity: 'LOW', type: 'insecure_protocol', message: 'Insecure HTTP URL (not HTTPS)' },
  ];
  
  lines.forEach((line, idx) => {
    patterns.forEach(p => {
      if (p.regex.test(line)) {
        findings.push({
          line: idx + 1,
          severity: p.severity,
          type: p.type,
          message: p.message,
          code: line.substring(0, 80)
        });
      }
    });
  });
  
  return {
    scanType: 'quick',
    findings: findings.slice(0, 20), // Limit to top 20
    totalFindings: findings.length,
    recommendation: findings.length > 0 ? 'Run full AI security scan for detailed analysis' : 'No obvious issues found'
  };
}

module.exports = { 
  reviewCode, 
  generateDescription,
  analyzePRSize,
  extractDiffStats, 
  extractFileChanges,
  quickSecurityScan,
  MODEL,
  PR_SIZE 
};
