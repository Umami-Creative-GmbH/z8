#!/usr/bin/env bash
set -euo pipefail
export PATH="/c/Users/KaiHentschel/scoop/apps/git/current/usr/bin:$PATH"
exec bash scripts/run-approval-workflow-repository-integration.sh \
  src/lib/approvals/server/time-approval-decision.integration.test.ts \
  -t 'requester correction listing' --maxWorkers 1 \
  --reporter=json --outputFile="../../.tmp/1722-root-checks/$1.json"
