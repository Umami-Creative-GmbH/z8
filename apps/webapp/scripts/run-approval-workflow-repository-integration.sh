#!/usr/bin/env bash
# Starts an isolated PostgreSQL 16 database, applies the full migration chain,
# runs the gated contract suite, and removes only its label-owned container.
set -euo pipefail

readonly sentinel="approval-workflow-repository-test"
readonly suffix="$(date +%s%N)_${RANDOM}"
readonly database_name="approval_workflow_repository_test_${suffix}"
readonly container_name="z8_approval_workflow_repository_test_${suffix}"
readonly database_password="approvalworkflowtest_${suffix}"
readonly app_directory="$(realpath "$(dirname "$0")/..")"
container_started=false

cleanup() {
	local result=$?
	set +e

	if [ "$container_started" = true ] && docker inspect "$container_name" >/dev/null 2>&1; then
		local owner_label
		owner_label="$(docker inspect --format '{{ index .Config.Labels "z8.agent-owned" }}' "$container_name")"
		if [ "$owner_label" = "$sentinel" ]; then
			printf 'Verified container ownership label: %s=%s\n' "z8.agent-owned" "$owner_label"
			docker rm --force "$container_name"
			printf 'Removed disposable PostgreSQL container: %s\n' "$container_name"
		else
			printf 'Refusing to remove %s: z8.agent-owned is %s\n' "$container_name" "$owner_label" >&2
			result=1
		fi
	fi

	local remaining
	remaining="$(docker ps --all --filter "name=^/${container_name}$" --format '{{.Names}}')"
	if [ -n "$remaining" ]; then
		printf 'Disposable approval workflow container still exists: %s\n' "$remaining" >&2
		result=1
	fi

	return "$result"
}
trap cleanup EXIT

docker run --detach --name "$container_name" \
	--label z8.agent-owned=approval-workflow-repository-test \
	--env "POSTGRES_PASSWORD=${database_password}" \
	--publish 127.0.0.1::5432 \
	postgres:16 >/dev/null
container_started=true
printf 'Started label-owned PostgreSQL 16 container: %s\n' "$container_name"

for attempt in $(seq 1 30); do
	if docker exec "$container_name" pg_isready --username postgres --dbname postgres >/dev/null; then
		break
	fi
	if [ "$attempt" -eq 30 ]; then
		printf 'PostgreSQL 16 did not become ready\n' >&2
		exit 1
	fi
	sleep 1
done
printf 'PostgreSQL 16 is ready: %s\n' "$container_name"

readonly host_port="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$container_name")"
docker exec "$container_name" createdb --username postgres "$database_name"
printf 'Created disposable database: %s\n' "$database_name"

printf 'Verifying approval migration incident recovery, retry, and fresh chain\n'
POSTGRES_HOST=127.0.0.1 \
POSTGRES_PORT="$host_port" \
POSTGRES_DB="$database_name" \
POSTGRES_USER=postgres \
POSTGRES_PASSWORD="$database_password" \
POSTGRES_SSL_MODE=disable \
SKIP_ENV_VALIDATION=1 \
APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL="postgresql://postgres:${database_password}@127.0.0.1:${host_port}/${database_name}" \
APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL=approval-workflow-repository-test \
pnpm --dir "$app_directory" exec tsx ./scripts/verify-approval-migration-recovery.ts

printf 'Running gated approval workflow repository and engine integration suites\n'
POSTGRES_HOST=127.0.0.1 \
POSTGRES_PORT="$host_port" \
POSTGRES_DB="$database_name" \
POSTGRES_USER=postgres \
POSTGRES_PASSWORD="$database_password" \
POSTGRES_SSL_MODE=disable \
TZ=UTC \
PGOPTIONS="-c statement_timeout=15000 -c timezone=UTC" \
APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL="postgresql://postgres:${database_password}@127.0.0.1:${host_port}/${database_name}" \
APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL=approval-workflow-repository-test \
APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED=1 \
pnpm --dir "$app_directory" exec vitest run --no-file-parallelism \
	src/lib/scim/scim-callback-atomicity.integration.test.ts \
	src/lib/scim/seat-sync-outbox.integration.test.ts \
	src/lib/scim/protocol.integration.test.ts \
	src/lib/approvals/workflow/repository.integration.test.ts \
	src/lib/approvals/workflow/transition-engine.integration.test.ts \
	src/lib/approvals/server/time-correction-approvals.integration.test.ts \
	src/lib/approvals/server/work-period-approvals.integration.test.ts
