---
name: code-review
description: Review code changes for bugs, security issues, performance problems, and adherence to best practices. Provides actionable feedback with specific file and line references.
---

# Code Review Skill

Perform a thorough code review following this process:

## Review Checklist

1. **Correctness** — Does the code do what it claims? Are there logic errors or edge cases?
2. **Security** — Are there injection risks, authentication gaps, or data exposure?
3. **Performance** — Are there N+1 queries, unnecessary allocations, or blocking calls?
4. **Maintainability** — Is the code readable? Are names clear? Is complexity reasonable?
5. **Testing** — Are critical paths tested? Are edge cases covered?

## Process

1. Read the files or diff under review using the `read` tool
2. Search for related code with `grep` to understand context
3. Identify issues and categorize by severity: critical, warning, suggestion
4. Provide specific fixes with file path and line number references

## Output Format

For each issue found:
- **File:Line** — Brief description
- **Severity** — Critical / Warning / Suggestion
- **Fix** — Specific code change or recommendation
