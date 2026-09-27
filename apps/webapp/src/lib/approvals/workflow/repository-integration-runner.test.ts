import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const runnerPath = fileURLToPath(
	new URL(
		"../../../../scripts/run-approval-workflow-repository-integration.sh",
		import.meta.url,
	),
);
const suitesPath = fileURLToPath(
	new URL(
		"../../../../scripts/run-postgres-integration-suites.sh",
		import.meta.url,
	),
);

async function readScript(scriptPath: string) {
	// Windows autocrlf checkouts read CRLF; the contract is written against LF.
	return (await readFile(scriptPath, "utf8")).replace(/\r\n/g, "\n");
}

describe("approval workflow repository integration runner", () => {
	it("owns a labelled PostgreSQL 16 lifecycle and hands its URL to the shared suite runner", async () => {
		const runner = await readScript(runnerPath);

		expect(runner).toContain("postgres:16");
		expect(runner).toContain(
			"z8.agent-owned=approval-workflow-repository-test",
		);
		expect(runner).toContain("approval_workflow_repository_test_");
		expect(runner).toContain("pg_isready");
		expect(runner).not.toContain("--throw-deprecation");
		expect(runner).toContain("docker inspect");
		expect(runner).toContain("trap cleanup EXIT");
		expect(runner).toContain("Verified container ownership label");
		expect(runner).toContain("PostgreSQL 16 is ready");
		expect(runner).toContain("Removed disposable PostgreSQL container");
		expect(runner).toContain(
			[
				'bash "$app_directory/scripts/run-postgres-integration-suites.sh" \\',
				// biome-ignore lint/suspicious/noTemplateCurlyInString: shell variables
				'\t"postgresql://postgres:${database_password}@127.0.0.1:${host_port}/${database_name}"',
			].join("\n"),
		);
		expect(runner).not.toContain(".integration.test.ts");
	});

	it("passes the required database safety environment to the migration verifier", async () => {
		const suites = await readScript(suitesPath);
		const verifierLine =
			"SKIP_ENV_VALIDATION=1 pnpm exec tsx ./scripts/verify-approval-migration-recovery.ts";
		const beforeVerifier = suites.slice(0, suites.indexOf(verifierLine));

		expect(suites).toContain(verifierLine);
		for (const assignment of [
			"export POSTGRES_HOST=",
			"export POSTGRES_PORT=",
			"export POSTGRES_DB=",
			"export POSTGRES_USER=",
			"export POSTGRES_PASSWORD=",
			"export POSTGRES_SSL_MODE=disable",
			'export APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL="$database_url"',
			"export APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL=approval-workflow-repository-test",
		]) {
			expect(beforeVerifier).toContain(assignment);
		}
	});

	it("runs the whole integration project after the verifier, with no suite list", async () => {
		const suites = await readScript(suitesPath);
		const vitestLine = 'pnpm exec vitest run --project integration "$@"';

		expect(suites).toContain(vitestLine);
		expect(suites.indexOf(vitestLine)).toBeGreaterThan(
			suites.indexOf("verify-approval-migration-recovery.ts"),
		);
		expect(suites).not.toContain(".integration.test.ts");
		// The integration project's env owns these; the script must not fork them.
		expect(suites).not.toContain("PGOPTIONS");
		expect(suites).not.toContain("APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED");
	});
});
