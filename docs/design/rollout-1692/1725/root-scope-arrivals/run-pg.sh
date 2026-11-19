#!/usr/bin/env bash
set -euo pipefail
export PATH="/c/Users/KaiHentschel/scoop/apps/git/current/usr/bin:$PATH"
exec bash scripts/run-approval-workflow-repository-integration.sh \
  src/lib/payroll-export/grant-holder-export.integration.test.ts \
  src/lib/payroll-export/comparison-service.integration.test.ts \
  src/lib/payroll-export/baseline-evidence.integration.test.ts \
  src/lib/payroll-export/comparison-explanations.integration.test.ts \
  src/lib/payroll-export/overtime-payouts.integration.test.ts \
  --maxWorkers 1 --reporter=json --outputFile=../../.tmp/1725-root-checks/postgres.json
