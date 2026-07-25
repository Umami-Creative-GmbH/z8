import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const runnerPath = fileURLToPath(
	new URL(
		"../../../../scripts/run-approval-workflow-repository-integration.sh",
		import.meta.url,
	),
);

describe("approval workflow repository integration runner", () => {
	it("owns a labelled PostgreSQL 16 lifecycle and passes both test gates", async () => {
		const runner = await readFile(runnerPath, "utf8");

		expect(runner).toContain("postgres:16");
		expect(runner).toContain(
			"z8.agent-owned=approval-workflow-repository-test",
		);
		expect(runner).toContain("approval_workflow_repository_test_");
		expect(runner).toContain("pg_isready");
		expect(runner).toContain(
			'pnpm --dir "$app_directory" exec drizzle-kit migrate',
		);
		expect(runner).toContain("SKIP_ENV_VALIDATION=1");
		expect(runner).toContain(
			"APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL=approval-workflow-repository-test",
		);
		expect(runner).toContain("APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED=1");
		expect(runner).toContain('POSTGRES_DB="$database_name"');
		expect(runner).toContain('POSTGRES_PORT="$host_port"');
		expect(runner).toContain(`POSTGRES_HOST=127.0.0.1 \\
POSTGRES_PORT="$host_port" \\
POSTGRES_DB="$database_name" \\
POSTGRES_USER=postgres \\
POSTGRES_PASSWORD="$database_password" \\
POSTGRES_SSL_MODE=disable \\
PGOPTIONS="-c statement_timeout=15000 -c timezone=UTC" \\
NODE_OPTIONS="\${NODE_OPTIONS:+\${NODE_OPTIONS} }--throw-deprecation" \\
APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL=`);
		expect(runner).toContain("docker inspect");
		expect(runner).toContain("trap cleanup EXIT");
		expect(runner).toContain("Verified container ownership label");
		expect(runner).toContain("PostgreSQL 16 is ready");
		expect(runner).toContain("Removed disposable PostgreSQL container");
		expect(runner).toContain(
			"src/lib/approvals/workflow/transition-engine.integration.test.ts",
		);
		expect(runner).toContain(
			"src/lib/approvals/server/time-correction-approvals.integration.test.ts",
		);
		expect(runner).toContain(
			"src/lib/approvals/server/work-period-approvals.integration.test.ts",
		);
	});
});
