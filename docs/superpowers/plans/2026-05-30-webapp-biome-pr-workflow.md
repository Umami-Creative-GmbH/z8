# Webapp Biome PR Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions pull request workflow that runs Biome CI against `apps/webapp/src` only.

**Architecture:** Create one PR-only workflow file under `.github/workflows`. The job follows existing repository workflow conventions: pinned actions, `pnpm`, Node 24, least-required permissions, concurrency cancellation, and a frozen lockfile install before running the app-local Biome binary. The workflow captures Biome output, always writes an Actions job summary, upserts one bot PR comment when the PR comes from the same repository, then fails the job when Biome exits non-zero.

**Tech Stack:** GitHub Actions, pnpm 11.4.0, Node.js 24, Biome 2.4.16.

---

### Task 1: Add Webapp Biome Workflow

**Files:**
- Create: `.github/workflows/biome.yml`

- [ ] **Step 1: Create the workflow file**

```yaml
name: Biome

on:
  pull_request:
    branches:
      - main
    paths:
      - "apps/webapp/src/**"
      - ".github/workflows/biome.yml"

permissions:
  contents: read
  issues: write
  pull-requests: read

concurrency:
  group: biome-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  biome:
    name: Biome
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          persist-credentials: false

      - name: Set up pnpm
        uses: pnpm/action-setup@0e279bb959325dab635dd2c09392533439d90093 # v6.0.8
        with:
          package_json_file: package.json

      - name: Set up Node.js
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version: 24
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run Biome
        id: biome
        working-directory: apps/webapp
        run: |
          set +e
          pnpm exec biome ci --max-diagnostics=30 src > "$RUNNER_TEMP/biome-output.txt" 2>&1
          status=$?
          set -e

          echo "status=$status" >> "$GITHUB_OUTPUT"

      - name: Add Biome result to job summary
        if: always()
        run: |
          status="${{ steps.biome.outputs.status }}"
          conclusion="failed"
          if [ "$status" = "0" ]; then
            conclusion="passed"
          fi

          {
            echo "### Biome src check $conclusion"
            echo
            echo "\`pnpm exec biome ci --max-diagnostics=30 src\` in \`apps/webapp\` exited with status \`${status:-unknown}\`."
            echo
            echo "<details><summary>Biome output</summary>"
            echo
            echo '```text'
            if [ -f "$RUNNER_TEMP/biome-output.txt" ]; then
              head -c 60000 "$RUNNER_TEMP/biome-output.txt"
            else
              echo "Biome output was not captured."
            fi
            echo
            echo '```'
            echo
            echo "</details>"
          } >> "$GITHUB_STEP_SUMMARY"

      - name: Comment Biome result
        if: always() && github.event.pull_request.head.repo.full_name == github.repository
        uses: actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3 # v9.0.0
        with:
          script: |
            const fs = require("node:fs");

            const marker = "<!-- z8-biome-src-result -->";
            const status = "${{ steps.biome.outputs.status }}";
            const outputPath = `${process.env.RUNNER_TEMP}/biome-output.txt`;
            const output = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "Biome output was not captured.";
            const conclusion = status === "0" ? "passed" : "failed";
            const maxOutputLength = 60000;
            const trimmedOutput = output.length > maxOutputLength
              ? `${output.slice(0, maxOutputLength)}\n\n[Output truncated]`
              : output;
            const body = `${marker}\n### Biome src check ${conclusion}\n\n\`pnpm exec biome ci --max-diagnostics=30 src\` in \`apps/webapp\` exited with status \`${status || "unknown"}\`.\n\n<details><summary>Biome output</summary>\n\n\`\`\`text\n${trimmedOutput}\n\`\`\`\n\n</details>`;

            const { owner, repo } = context.repo;
            const issue_number = context.issue.number;
            const comments = await github.paginate(github.rest.issues.listComments, {
              owner,
              repo,
              issue_number,
              per_page: 100,
            });
            const previousComment = comments.find((comment) => comment.user.type === "Bot" && comment.body.includes(marker));

            if (previousComment) {
              await github.rest.issues.updateComment({
                owner,
                repo,
                comment_id: previousComment.id,
                body,
              });
            } else {
              await github.rest.issues.createComment({
                owner,
                repo,
                issue_number,
                body,
              });
            }

      - name: Fail on Biome errors
        if: steps.biome.outputs.status != '0'
        run: exit 1
```

- [ ] **Step 2: Verify workflow syntax and local command viability**

Run: `pnpm --dir apps/webapp exec biome ci --max-diagnostics=30 src`

Expected: Biome runs against `apps/webapp/src`. Existing source diagnostics may fail this command, but the command must resolve the local Biome binary and target the intended directory.

- [ ] **Step 3: Inspect git diff**

Run: `git diff -- .github/workflows/biome.yml docs/superpowers/plans/2026-05-30-webapp-biome-pr-workflow.md`
Expected: Diff contains the new workflow and this plan only.
