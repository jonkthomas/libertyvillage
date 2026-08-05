# Autonomous promotion repository setup

The coordinator workflow must exist on the default branch (`main`) before a generator dispatch can start it. After this implementation is reviewed and lands on `main`, configure the repository once with an administrator token:

```bash
# Read-only preview (default):
scripts/setup-autonomous-protections.sh owner/repo

# Apply the idempotent GitHub API configuration:
scripts/setup-autonomous-protections.sh owner/repo --apply
```

The script enables native auto-merge, permits Actions-created PRs, and protects both `staging` and `main`. Each branch requires a pull request plus strict `automation/ci` and `automation/opus-gate` statuses, with zero human approvals. Force pushes and branch deletion remain disabled. It does not push, create a PR, or merge a branch.

Repository secrets:

- `ANTHROPIC_API_KEY` — required by the trusted Opus reviewer and Sonnet fixer jobs.
- `SLACK_WEBHOOK_URL` — optional; blocked-run notification is skipped when absent.
- Existing generator-specific secrets remain as documented in their workflows.

The workflows use the repository `GITHUB_TOKEN` for explicit `repository_dispatch`; no PAT or GitHub App token is required. The coordinator checks the live PR, exact head SHA, author, same-repository head, branch/base pair, and kind-specific path budget before any secret-bearing or write job can run.
