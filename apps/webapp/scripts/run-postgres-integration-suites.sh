#!/usr/bin/env bash
# Verifies the approval migration chain, then runs every PostgreSQL suite
# (the Vitest `integration` project) against one disposable PostgreSQL database.
# Callers own the database lifecycle: the local Docker runner and the CI job.
#
# Usage: run-postgres-integration-suites.sh <database-url> [vitest args...]
set -euo pipefail

if [ "$#" -lt 1 ]; then
	printf 'Usage: %s postgresql://user:password@host:port/database [vitest args...]\n' "$0" >&2
	exit 2
fi
readonly database_url="$1"
shift

readonly url_pattern='^postgres(ql)?://([^:@/]+):([^@/]*)@([^:@/]+):([0-9]+)/([^/?]+)$'
if [[ ! "$database_url" =~ $url_pattern ]]; then
	printf 'Expected a postgresql://user:password@host:port/database URL\n' >&2
	exit 2
fi
export POSTGRES_USER="${BASH_REMATCH[2]}"
export POSTGRES_PASSWORD="${BASH_REMATCH[3]}"
export POSTGRES_HOST="${BASH_REMATCH[4]}"
export POSTGRES_PORT="${BASH_REMATCH[5]}"
export POSTGRES_DB="${BASH_REMATCH[6]}"
export POSTGRES_SSL_MODE=disable
export APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL="$database_url"
export APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL=approval-workflow-repository-test

cd "$(dirname "$0")/.."

printf 'Verifying approval migration incident recovery, retry, and fresh chain\n'
SKIP_ENV_VALIDATION=1 pnpm exec tsx ./scripts/verify-approval-migration-recovery.ts

printf 'Running the PostgreSQL integration project\n'
pnpm exec vitest run --project integration "$@"
