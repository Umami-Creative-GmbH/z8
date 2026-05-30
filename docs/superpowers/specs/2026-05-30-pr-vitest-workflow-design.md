# PR Vitest Workflow Design

## Goal

Add a GitHub Actions workflow that checks pull requests against the repo's documented test command, `pnpm test`, and reports a concise pass/fail result in the GitHub Actions step summary.

## Workflow

- Create `.github/workflows/tests.yml`.
- Trigger on `pull_request` events targeting `main`.
- Limit runs to changes that can affect tests: application code, packages, Docker scripts tested by the root command, Dockerfiles, Docker target files, infra app manifests, package and lock files, Turbo config, and the workflow file itself.
- Use `contents: read` permissions only.
- Use a per-PR concurrency group and cancel superseded runs.

## Execution

- Run on `ubuntu-latest` with Node.js `24`, matching existing workflows.
- Set up pnpm from `package.json` with `pnpm/action-setup`.
- Enable pnpm caching through `actions/setup-node`.
- Install dependencies with `pnpm install --frozen-lockfile`.
- Run `pnpm test`, which includes the Docker runtime script test and Turbo workspace tests.

## Reporting

- The workflow check status is the authoritative PR pass/fail signal.
- The test step writes a compact Markdown summary to `$GITHUB_STEP_SUMMARY` showing the command and result.
- Full test details remain in the Actions logs.

## Error Handling

- If installation fails, the workflow fails before tests and reports the failing install step.
- If `pnpm test` fails, the workflow records a failed summary and exits non-zero.
- If tests pass, the workflow records a passed summary.

## Verification

- Validate the workflow YAML structure locally by inspection.
- Run `pnpm test` locally to verify the command used by CI succeeds in the current workspace.
