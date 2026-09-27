#!/usr/bin/env bash
# Starts an isolated PostgreSQL 16 database, hands it to the shared suite runner
# (migration verifier + the Vitest `integration` project), and removes only its
# label-owned container. Extra arguments are passed through to Vitest.
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

bash "$app_directory/scripts/run-postgres-integration-suites.sh" \
	"postgresql://postgres:${database_password}@127.0.0.1:${host_port}/${database_name}" \
	"$@"
