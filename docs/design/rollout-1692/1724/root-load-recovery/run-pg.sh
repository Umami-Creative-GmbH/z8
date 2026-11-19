#!/usr/bin/env bash
set -euo pipefail
export PATH="/c/Users/KaiHentschel/scoop/apps/git/current/usr/bin:$PATH"
exec bash scripts/run-approval-workflow-repository-integration.sh \
  'src/app/[locale]/(app)/organization/org-explorer.integration.test.ts' \
  --maxWorkers 1 --reporter=json \
  --outputFile=../../.tmp/1724-root-checks/postgres.json
