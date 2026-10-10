import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packagePath = fileURLToPath(new URL("../../../../package.json", import.meta.url));

const workflowPath = fileURLToPath(
	new URL("../../../../../../.github/workflows/tests.yml", import.meta.url),
);

async function readWorkflow() {
	// Windows autocrlf checkouts read CRLF; the contract is written against LF.
	return (await readFile(workflowPath, "utf8")).replace(/\r\n/g, "\n");
}

describe("approval workflow repository integration CI contract", () => {
	it("enables the filtered PR trigger and runs the PostgreSQL migration integration gate", async () => {
		const workflow = await readWorkflow();

		// `apps/webapp/**` covers vitest.config.ts and the shared suite runner.
		expect(workflow).toMatch(`on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review, converted_to_draft]
    branches:
      - main
    paths:
      - "apps/webapp/**"
      - "apps/desktop/**"
      - "packages/**"
      - "!**/*.md"
      - "docker/scripts/**"
      - "docker/Dockerfile.*"
      - "docker/targets/**"
      - "scripts/**"
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - "turbo.json"
      - ".github/scripts/**"
      - ".github/workflows/tests.yml"
      - ".github/workflows/ci-debounce.yml"
  workflow_dispatch:`);
		expect(workflow).toMatch(
			/services:\n {6}postgres:\n(?: {8}#[^\n]*\n)* {8}image: public\.ecr\.aws\/docker\/library\/postgres:16/,
		);
		expect(workflow).toContain(
			`- name: Run PostgreSQL integration suites
        id: test-run
        run: |
          set -euo pipefail
          database_name="approval_workflow_repository_test_\${GITHUB_RUN_ID}_\${GITHUB_RUN_ATTEMPT}"`,
		);
		expect(workflow).toContain(
			`bash apps/webapp/scripts/run-postgres-integration-suites.sh \\
            "postgresql://postgres:postgres@127.0.0.1:5432/\${database_name}"`,
		);
	});

	it("shares the suite runner instead of duplicating its list and environment", async () => {
		const workflow = await readWorkflow();

		expect(workflow).not.toContain(".integration.test.ts");
		expect(workflow).not.toContain("verify-approval-migration-recovery.ts");
		expect(workflow).not.toContain("APPROVAL_WORKFLOW_REPOSITORY_TEST_");
		expect(workflow).not.toContain("PGOPTIONS");
		expect(workflow).not.toContain("TZ=UTC");
	});

	it("runs only the unit project in the sharded unit job", async () => {
		const workflow = await readWorkflow();
		const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
		expect(packageJson.scripts.test).toContain("vitest run --project unit");

		expect(workflow).toContain(
			// biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions expression
			"pnpm --filter webapp test --shard=${{ matrix.shard }}/2",
		);
	});
});
