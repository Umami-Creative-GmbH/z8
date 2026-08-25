import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workflowPath = fileURLToPath(
	new URL("../../../../../../.github/workflows/tests.yml", import.meta.url),
);

describe("approval workflow repository integration CI contract", () => {
	it("enables the filtered PR trigger and runs the PostgreSQL migration integration gate", async () => {
		const workflow = await readFile(workflowPath, "utf8");

		expect(workflow).toMatch(`on:
  pull_request:
    branches:
      - main
    paths:
      - "apps/**"
      - "packages/**"
      - "docker/scripts/**"
      - "docker/Dockerfile.*"
      - "docker/targets/**"
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - "turbo.json"
      - ".github/workflows/tests.yml"
  workflow_dispatch:`);
		expect(workflow).toContain(`services:
      postgres:
        image: postgres:16`);
		expect(workflow).toContain(
			`- name: Run approval workflow repository PostgreSQL integration contract
        run: |
          set -euo pipefail
          database_name="approval_workflow_repository_test_\${GITHUB_RUN_ID}_\${GITHUB_RUN_ATTEMPT}"`,
		);
		expect(workflow).toContain(
			`SKIP_ENV_VALIDATION=1 \\
          APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/\${database_name}" \\
          APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL=approval-workflow-repository-test \\
          pnpm --filter webapp exec tsx scripts/verify-approval-migration-recovery.ts`,
		);
		expect(workflow).toContain("APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED=1");
		expect(workflow).toContain(
			`APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED=1 \\
           TZ=UTC \\
           PGOPTIONS="-c statement_timeout=15000 -c timezone=UTC" \\
           pnpm --filter webapp exec vitest run`,
		);
		expect(workflow).toContain(
			"src/lib/scim/seat-sync-outbox.integration.test.ts",
		);
		expect(workflow).toContain(
			"src/lib/scim/scim-callback-atomicity.integration.test.ts",
		);
		expect(workflow).toContain("src/lib/scim/protocol.integration.test.ts");
		expect(workflow).toMatch(
			/seat-sync-outbox\.integration\.test\.ts \\\n+\s+src\/lib\/scim\/protocol\.integration\.test\.ts \\\n+\s+src\/lib\/approvals\/workflow\/repository\.integration\.test\.ts \\\n+\s+src\/lib\/approvals\/workflow\/transition-engine\.integration\.test\.ts \\\n+\s+src\/lib\/approvals\/server\/time-correction-approvals\.integration\.test\.ts \\\n+\s+src\/lib\/approvals\/server\/work-period-approvals\.integration\.test\.ts/,
		);
	});
});
